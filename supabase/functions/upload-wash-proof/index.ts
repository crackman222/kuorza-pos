import { createClient } from 'npm:@supabase/supabase-js@2'

const BUCKET = 'foto_kendaraan'
const WASH_PROOF_TYPE = 'bukti_cuci'

// Generous enough for a full-resolution phone photo, small enough that one
// request can't burn through the Tinify quota or the function's memory.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

// ALLOWED_ORIGIN is optional: set it (`supabase secrets set
// ALLOWED_ORIGIN=https://your-app.vercel.app`) to restrict which browser
// origins can read this function's response. Unset, it falls back to '*'
// (today's behavior) — the caller/profile check and treatment validation
// below are the real access control either way, CORS is just defense in
// depth.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Compresses an uploaded wash-proof photo via Tinify, then stores the
// compressed result in the foto_kendaraan bucket and upserts the matching
// photos row. Runs server-side (not in the browser) because Tinify's API
// has no CORS support — a client-side call would both fail and expose the
// API key to anyone inspecting network requests.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const tinifyApiKey = Deno.env.get('TINIFY_API_KEY')
    if (!tinifyApiKey) {
      return jsonResponse({ error: 'TINIFY_API_KEY belum diatur di secrets project.' }, 500)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    )

    // verify_jwt alone isn't enough: the project's anon key is itself a valid
    // JWT, so it would pass the gateway. Require a real signed-in user whose
    // profile is still active — same rule login() applies on the client.
    const callerToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: callerUser, error: callerError } = await supabaseAdmin.auth.getUser(callerToken)
    if (callerError || !callerUser?.user) {
      return jsonResponse({ error: 'Tidak terautentikasi.' }, 401)
    }

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('profiles')
      .select('is_active')
      .eq('id', callerUser.user.id)
      .maybeSingle()
    if (callerProfileError || !callerProfile?.is_active) {
      return jsonResponse({ error: 'Akun tidak aktif.' }, 403)
    }

    const form = await req.formData()
    const file = form.get('file')
    const rawTreatmentId = form.get('treatmentId')

    if (!(file instanceof File) || !rawTreatmentId) {
      return jsonResponse({ error: 'file dan treatmentId wajib diisi' }, 400)
    }
    // treatmentId becomes the storage folder name, so anything but a plain
    // integer could steer the upload to an arbitrary path in the bucket.
    if (typeof rawTreatmentId !== 'string' || !/^\d+$/.test(rawTreatmentId)) {
      return jsonResponse({ error: 'treatmentId tidak valid' }, 400)
    }
    const treatmentId = Number(rawTreatmentId)

    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return jsonResponse({ error: 'Ukuran foto maksimal 15 MB' }, 413)
    }
    if (file.type && !file.type.startsWith('image/')) {
      return jsonResponse({ error: 'File harus berupa foto' }, 400)
    }

    // Check before spending a Tinify compression on it.
    const { data: treatment, error: treatmentError } = await supabaseAdmin
      .from('treatments')
      .select('id')
      .eq('id', treatmentId)
      .maybeSingle()
    if (treatmentError) throw treatmentError
    if (!treatment) {
      return jsonResponse({ error: 'Transaksi tidak ditemukan' }, 404)
    }

    const originalBytes = new Uint8Array(await file.arrayBuffer())
    const authHeader = `Basic ${btoa(`api:${tinifyApiKey}`)}`

    const shrinkRes = await fetch('https://api.tinify.com/shrink', {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: originalBytes,
    })

    if (!shrinkRes.ok) {
      const detail = await shrinkRes.text()
      return jsonResponse({ error: `Kompresi Tinify gagal: ${shrinkRes.status} ${detail}` }, 502)
    }

    const shrinkResult = await shrinkRes.json()
    const outputUrl = shrinkResult.output.url

    const compressedRes = await fetch(outputUrl, {
      headers: { Authorization: authHeader },
    })
    if (!compressedRes.ok) {
      return jsonResponse({ error: `Unduh hasil kompresi gagal: ${compressedRes.status}` }, 502)
    }

    const compressedBytes = new Uint8Array(await compressedRes.arrayBuffer())
    const contentType = shrinkResult.output.type || file.type || 'image/jpeg'
    const path = `${treatmentId}/bukti-cuci`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, compressedBytes, { upsert: true, contentType })
    if (uploadError) throw uploadError

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('photos')
      .select('id')
      .eq('treatment_id', treatmentId)
      .eq('photo_type', WASH_PROOF_TYPE)
      .maybeSingle()
    if (fetchError) throw fetchError

    if (existing) {
      const { error } = await supabaseAdmin
        .from('photos')
        .update({ image_url: path, uploaded_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabaseAdmin
        .from('photos')
        .insert({ treatment_id: treatmentId, image_url: path, photo_type: WASH_PROOF_TYPE })
      if (error) throw error
    }

    return jsonResponse({
      path,
      originalSize: shrinkResult.input.size,
      compressedSize: shrinkResult.output.size,
    })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Terjadi kesalahan' }, 500)
  }
})
