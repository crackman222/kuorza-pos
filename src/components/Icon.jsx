import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  AddCircleIcon,
  Alert02Icon,
  AlertCircleIcon,
  Analytics01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BankIcon,
  BaseballHelmetIcon,
  Book02Icon,
  Calendar03Icon,
  Camera01Icon,
  Cancel01Icon,
  Car01Icon,
  Cash01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DashboardSquare01Icon,
  DropletsIcon,
  Delete02Icon,
  GridViewIcon,
  HourglassIcon,
  Invoice01Icon,
  LeftToRightListBulletIcon,
  Loading03Icon,
  LockPasswordIcon,
  Logout01Icon,
  Menu01Icon,
  MinusSignIcon,
  Money01Icon,
  Motorbike01Icon,
  PlayIcon,
  QrCodeIcon,
  RefreshIcon,
  Search01Icon,
  TaskDone01Icon,
  Tick02Icon,
  UserAdd01Icon,
  UserGroupIcon,
  UserIcon,
} from '@hugeicons/core-free-icons'

// Icons are named by role, not by the Hugeicons export, so a call site reads
// <Icon name="photo_camera" /> and swapping a glyph is a one-line change here.
const ICONS = {
  account_balance: BankIcon,
  add: Add01Icon,
  add_circle: AddCircleIcon,
  brand: DropletsIcon,
  arrow_back: ArrowLeft01Icon,
  calendar_today: Calendar03Icon,
  category: GridViewIcon,
  check: Tick02Icon,
  check_circle: CheckmarkCircle02Icon,
  chevron_right: ArrowRight01Icon,
  close: Cancel01Icon,
  dashboard: DashboardSquare01Icon,
  delete: Delete02Icon,
  directions_car: Car01Icon,
  done_all: TaskDone01Icon,
  error: AlertCircleIcon,
  expand_more: ArrowDown01Icon,
  format_list_bulleted: LeftToRightListBulletIcon,
  group: UserGroupIcon,
  group_add: UserAdd01Icon,
  hourglass_top: HourglassIcon,
  lock: LockPasswordIcon,
  logout: Logout01Icon,
  menu: Menu01Icon,
  menu_book: Book02Icon,
  monitoring: Analytics01Icon,
  payments: Cash01Icon,
  person: UserIcon,
  person_add: UserAdd01Icon,
  photo_camera: Camera01Icon,
  play_arrow: PlayIcon,
  progress_activity: Loading03Icon,
  qr_code_2: QrCodeIcon,
  receipt_long: Invoice01Icon,
  refresh: RefreshIcon,
  remove: MinusSignIcon,
  schedule: Clock01Icon,
  search: Search01Icon,
  sports_motorsports: BaseballHelmetIcon,
  task_alt: CheckmarkCircle02Icon,
  two_wheeler: Motorbike01Icon,
  wage: Money01Icon,
  warning: Alert02Icon,
}

// A Hugeicons glyph (stroke style, inherits currentColor). Decorative by
// default; pass `label` when the icon is the only thing conveying meaning.
// `fill` marks the selected state (e.g. the active nav item) with a heavier
// stroke, standing in for M3's filled-vs-outlined icon swap.
export function Icon({ name, fill = false, size = 24, label, className = '' }) {
  const icon = ICONS[name]
  if (!icon) {
    if (import.meta.env.DEV) console.warn(`Icon: unknown name "${name}"`)
    return null
  }
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      color="currentColor"
      strokeWidth={fill ? 2.2 : 1.6}
      className={`icon ${name === 'progress_activity' ? 'icon-spin' : ''} ${className}`.trim()}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
