import {
  Activity,
  AlarmClockCheck,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  BadgeCheck,
  Bandage,
  Banknote,
  Bell,
  BellOff,
  BellRing,
  BookOpen,
  Bot,
  Brain,
  Bug,
  Calculator,
  Calendar,
  CalendarDays,
  Camera,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CirclePause,
  CirclePlus,
  CircleX,
  Clock,
  Cloud,
  CloudOff,
  CloudUpload,
  Cog,
  Copy,
  CreditCard,
  Database,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FileOutput,
  FileText,
  GitCommitVertical,
  Globe,
  Hand,
  HardHat,
  History,
  ImageOff,
  ImagePlus,
  Images,
  Inbox,
  Info,
  Keyboard,
  KeyRound,
  Languages,
  Laptop,
  LayoutDashboard,
  Link,
  List,
  ListChecks,
  LoaderCircle,
  Lock,
  LockKeyhole,
  LogIn,
  type LucideIcon,
  Mail,
  MailOpen,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Monitor,
  MonitorDown,
  MonitorSmartphone,
  Network,
  Package,
  PackageOpen,
  PanelLeft,
  Pencil,
  Phone,
  Plus,
  Power,
  Printer,
  QrCode,
  ReceiptEuro,
  ReceiptText,
  RefreshCw,
  Repeat,
  Reply,
  Save,
  ScanLine,
  ScanSearch,
  Search,
  SearchX,
  Send,
  Settings,
  Shapes,
  Share2,
  ShieldCheck,
  ShieldUser,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SquarePlus,
  Star,
  StickyNote,
  Store,
  Tablet,
  Tag,
  Terminal,
  Timer,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Truck,
  Undo2,
  Unlink,
  Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  Wallet,
  Watch,
  Webhook,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";

type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<IconSize, string> = {
  xs: "text-[14px]",
  sm: "text-[18px]",
  md: "text-[20px]",
  lg: "text-[24px]",
  xl: "text-[32px]",
};

/**
 * Material Symbols name → Lucide glyph (design-system.md §7). Screens still
 * pass the Material name they always used, so swapping the icon set is a
 * one-file change and dynamic names (nav items, device and action maps from
 * @shared/constants) keep working. A name missing here falls back to the
 * Material font until it is mapped.
 *
 * Status icons are fixed by §3.2 (inbox, package, wrench, pause, circle-check,
 * package-check, undo-2, circle-x) and live in status-colors.ts, not here.
 */
const LUCIDE_BY_MATERIAL_NAME: Record<string, LucideIcon> = {
  account_balance_wallet: Wallet,
  account_tree: Network,
  add: Plus,
  add_a_photo: Camera,
  add_box: SquarePlus,
  add_circle: CirclePlus,
  add_photo_alternate: ImagePlus,
  admin_panel_settings: ShieldUser,
  alarm_on: AlarmClockCheck,
  analytics: ChartColumn,
  api: Webhook,
  arrow_back: ArrowLeft,
  arrow_drop_down: ChevronDown,
  arrow_forward: ArrowRight,
  arrow_right: ChevronRight,
  assignment_return: Undo2,
  auto_awesome: Sparkles,
  autorenew: RefreshCw,
  bar_chart: ChartColumn,
  bolt: Zap,
  bug_report: Bug,
  build: Wrench,
  build_circle: Wrench,
  cached: RefreshCw,
  calculate: Calculator,
  calendar_today: Calendar,
  call: Phone,
  cancel: CircleX,
  category: Shapes,
  chat: MessageCircle,
  check: Check,
  check_circle: CircleCheck,
  chevron_right: ChevronRight,
  circle: Circle,
  close: X,
  cloud: Cloud,
  cloud_off: CloudOff,
  cloud_upload: CloudUpload,
  content_copy: Copy,
  credit_card: CreditCard,
  currency_exchange: ArrowLeftRight,
  dashboard: LayoutDashboard,
  database: Database,
  delete: Trash2,
  description: FileText,
  desk: Monitor,
  devices: MonitorSmartphone,
  done_all: CheckCheck,
  download: Download,
  edit: Pencil,
  email: Mail,
  emoji_events: Trophy,
  engineering: HardHat,
  error: CircleAlert,
  error_circle_rounded: CircleAlert,
  error_outline: CircleAlert,
  event: CalendarDays,
  expand_less: ChevronUp,
  expand_more: ChevronDown,
  fact_check: ListChecks,
  file_export: FileOutput,
  forum: MessagesSquare,
  front_hand: Hand,
  group: Users,
  group_off: UserX,
  healing: Bandage,
  help: CircleHelp,
  hide_image: ImageOff,
  history: History,
  how_to_reg: UserCheck,
  inbox: Inbox,
  info: Info,
  install_mobile: MonitorDown,
  inventory: Package,
  inventory_2: Package,
  key: KeyRound,
  keyboard: Keyboard,
  label: Tag,
  language: Languages,
  laptop_mac: Laptop,
  link: Link,
  link_off: Unlink,
  list_alt: List,
  local_atm: Banknote,
  local_shipping: Truck,
  location_on: MapPin,
  lock: Lock,
  lock_reset: LockKeyhole,
  login: LogIn,
  mail: Mail,
  markdown: FileCode,
  menu: Menu,
  menu_book: BookOpen,
  monitoring: ChartLine,
  more_horiz: Ellipsis,
  more_vert: EllipsisVertical,
  network_check: Activity,
  north_east: ArrowUpRight,
  notifications: Bell,
  notifications_active: BellRing,
  notifications_off: BellOff,
  open_in_new: ExternalLink,
  outbox: PackageOpen,
  pause_circle: CirclePause,
  payments: Banknote,
  pending: Clock,
  people: Users,
  person: User,
  person_add: UserPlus,
  phone: Phone,
  phone_iphone: Smartphone,
  photo_camera: Camera,
  photo_library: Images,
  picture_as_pdf: FileText,
  pie_chart: ChartPie,
  point_of_sale: ReceiptEuro,
  power_settings_new: Power,
  precision_manufacturing: Cog,
  print: Printer,
  priority_high: CircleAlert,
  progress_activity: LoaderCircle,
  psychology: Brain,
  public: Globe,
  qr_code: QrCode,
  qr_code_scanner: ScanLine,
  rate_review: MessageSquareText,
  receipt_long: ReceiptText,
  refresh: RefreshCw,
  remove_circle: CircleMinus,
  repeat: Repeat,
  reply: Reply,
  request_quote: FileText,
  save: Save,
  schedule: Clock,
  search: Search,
  search_off: SearchX,
  sell: Tag,
  send: Send,
  settings: Settings,
  settings_backup_restore: ArchiveRestore,
  share: Share2,
  shopping_cart: ShoppingCart,
  shopping_cart_checkout: ShoppingCart,
  side_navigation: PanelLeft,
  smart_toy: Bot,
  smartphone: Smartphone,
  sort: ArrowUpDown,
  stacked_bar_chart: ChartColumnStacked,
  star: Star,
  sticky_note_2: StickyNote,
  stop: Square,
  storefront: Store,
  swap_horiz: ArrowLeftRight,
  sync: RefreshCw,
  system_update_alt: Download,
  tablet_mac: Tablet,
  task_alt: CircleCheck,
  terminal: Terminal,
  timeline: GitCommitVertical,
  timer: Timer,
  toggle_off: ToggleLeft,
  toggle_on: ToggleRight,
  travel_explore: ScanSearch,
  trending_down: TrendingDown,
  trending_up: TrendingUp,
  troubleshoot: ScanSearch,
  tune: SlidersHorizontal,
  undo: Undo2,
  unread: MailOpen,
  upload: Upload,
  verified: BadgeCheck,
  verified_user: ShieldCheck,
  visibility: Eye,
  visibility_off: EyeOff,
  warning: TriangleAlert,
  watch: Watch,
  wifi: Wifi,
};

// A font-size utility in className wins over the default size, the way a
// text-[18px] on the old icon span overrode the font's 24px.
const FONT_SIZE_CLASS =
  /(^|\s)(?:[a-z-]+:)*text-(?:\[\d|xs\b|sm\b|base\b|md\b|lg\b|[2-9]?xl\b)/;

export function lucideIconFor(name: string): LucideIcon | undefined {
  return LUCIDE_BY_MATERIAL_NAME[name];
}

interface IconProps {
  "aria-hidden"?: boolean;
  "aria-label"?: string;
  className?: string;
  color?: string;
  name: string;
  size?: IconSize;
  style?: CSSProperties;
  title?: string;
}

/**
 * Sized by font-size like the icon font it replaces: `.oos-icon` is 1em
 * square (24px by default), so `text-[18px]`, `text-lg` or a `size` all keep
 * working, and the stroke follows `currentColor`. Decorative unless an
 * aria-label is given.
 */
export function Icon({
  name,
  size,
  color,
  className,
  style,
  title,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  const isDecorative = !ariaLabel;
  const resolvedSize =
    size ?? (className && FONT_SIZE_CLASS.test(className) ? undefined : "md");
  const classes = [
    resolvedSize ? SIZE_CLASSES[resolvedSize] : undefined,
    color,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const Glyph = LUCIDE_BY_MATERIAL_NAME[name];

  if (!Glyph) {
    return (
      <span
        aria-hidden={ariaHidden ?? (isDecorative ? true : undefined)}
        className={["material-symbols-outlined", classes]
          .filter(Boolean)
          .join(" ")}
        role={isDecorative ? undefined : "img"}
        style={style}
        title={title}
      >
        {name}
      </span>
    );
  }

  return (
    <Glyph
      absoluteStrokeWidth={false}
      aria-hidden={ariaHidden ?? (isDecorative ? true : undefined)}
      aria-label={ariaLabel}
      className={["oos-icon", classes].filter(Boolean).join(" ")}
      data-icon={name}
      focusable="false"
      role={isDecorative ? undefined : "img"}
      style={style}
    >
      {title ? <title>{title}</title> : null}
    </Glyph>
  );
}
