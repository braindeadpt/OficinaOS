export interface ErrorInfo {
  message: string;
  status: number;
}

export const ERRORS = {
  // ── Auth ───────────────────────────────────────────────────────────────
  UNAUTHORIZED: { status: 401, message: "errors.unauthorized" },
  FORBIDDEN: { status: 403, message: "errors.forbidden" },
  ACCOUNT_DISABLED: { status: 403, message: "errors.account_disabled" },
  ACCOUNT_LOCKED: { status: 423, message: "errors.account_locked" },
  FORBIDDEN_STATUS_TRANSITION: {
    status: 403,
    message: "errors.forbidden_status_transition",
  },
  CANCEL_WINDOW_EXPIRED: {
    status: 403,
    message: "errors.cancel_window_expired",
  },
  CANCEL_NOT_CREATOR: { status: 403, message: "errors.cancel_not_creator" },
  CANNOT_DEACTIVATE_OWN: {
    status: 400,
    message: "errors.cannot_deactivate_own",
  },
  AVATAR_NOT_OWN: { status: 403, message: "errors.avatar_not_own" },
  CURRENT_PASSWORD_INCORRECT: {
    status: 400,
    message: "errors.current_password_incorrect",
  },
  PASSWORD_SAME_AS_OLD: { status: 400, message: "errors.password_same_as_old" },
  NO_PASSWORD_SET: { status: 400, message: "errors.no_password_set" },
  CANNOT_END_CURRENT_SESSION: {
    status: 400,
    message: "errors.cannot_end_current_session",
  },

  // ── Validation ─────────────────────────────────────────────────────────
  VALIDATION_ERROR: { status: 400, message: "errors.validation_error" },
  INVALID_CUSTOMER_ID: { status: 400, message: "errors.invalid_customer_id" },
  AT_LEAST_ONE_FIELD: { status: 400, message: "errors.at_least_one_field" },
  NO_FILE_UPLOADED: { status: 400, message: "errors.no_file_uploaded" },
  INVALID_FILE_TYPE: { status: 400, message: "errors.invalid_file_type" },
  INVALID_FILE_CONTENT: {
    status: 400,
    message: "errors.invalid_file_content",
  },
  FILE_TOO_LARGE: { status: 413, message: "errors.file_too_large" },
  MISSING_LOOKUP_PARAMS: {
    status: 400,
    message: "errors.missing_lookup_params",
  },
  INVALID_JOB_CODE: { status: 400, message: "errors.invalid_job_code" },
  INVALID_PHONE4: { status: 400, message: "errors.invalid_phone4" },
  INVALID_CURSOR: { status: 400, message: "errors.invalid_cursor" },
  IS_ACTIVE_BOOLEAN: { status: 400, message: "errors.is_active_boolean" },

  // ── Not Found ──────────────────────────────────────────────────────────
  NOT_FOUND: { status: 404, message: "errors.not_found" },
  JOB_NOT_FOUND: { status: 404, message: "errors.job_not_found" },
  CUSTOMER_NOT_FOUND: { status: 404, message: "errors.customer_not_found" },
  PART_NOT_FOUND: { status: 404, message: "errors.part_not_found" },
  REPAIR_NOT_FOUND: { status: 404, message: "errors.repair_not_found" },
  USER_NOT_FOUND: { status: 404, message: "errors.user_not_found" },
  TEMPLATE_NOT_FOUND: { status: 404, message: "errors.template_not_found" },
  SESSION_NOT_FOUND: { status: 404, message: "errors.session_not_found" },
  RESOURCE_NOT_FOUND: { status: 404, message: "errors.resource_not_found" },
  BRAND_NOT_FOUND: { status: 404, message: "errors.brand_not_found" },
  CONVERSATION_NOT_FOUND: {
    status: 404,
    message: "errors.conversation_not_found",
  },
  MESSAGE_NOT_FOUND: { status: 404, message: "errors.message_not_found" },
  INSTRUCTION_NOT_FOUND: {
    status: 404,
    message: "errors.instruction_not_found",
  },
  MEMORY_NOT_FOUND: { status: 404, message: "errors.memory_not_found" },
  AGENT_DEFINITION_NOT_FOUND: {
    status: 404,
    message: "errors.agent_definition_not_found",
  },

  // ── Conflict ───────────────────────────────────────────────────────────
  CONFLICT: { status: 409, message: "errors.conflict" },
  DUPLICATE_BRAND: { status: 409, message: "errors.duplicate_brand" },
  DUPLICATE_MODEL: { status: 409, message: "errors.duplicate_model" },
  DUPLICATE_REPAIR: { status: 409, message: "errors.duplicate_repair" },
  PART_IN_USE: { status: 409, message: "errors.part_in_use" },
  REPAIR_IN_USE: { status: 409, message: "errors.repair_in_use" },
  JOB_IN_TERMINAL_STATUS: {
    status: 409,
    message: "errors.job_in_terminal_status",
  },
  CONFLICT_STATUS_TRANSITION: {
    status: 409,
    message: "errors.conflict_status_transition",
  },
  PHOTO_LIMIT_REACHED: { status: 409, message: "errors.photo_limit_reached" },
  USERNAME_EXISTS: { status: 409, message: "errors.username_exists" },
  EMAIL_EXISTS: { status: 409, message: "errors.email_exists" },

  // ── Business Logic ─────────────────────────────────────────────────────
  INVALID_CUSTOMER: { status: 400, message: "errors.invalid_customer" },
  INSUFFICIENT_STOCK: { status: 409, message: "errors.insufficient_stock" },
  INVALID_PAYMENT_AMOUNT: {
    status: 400,
    message: "errors.invalid_payment_amount",
  },
  PAYMENT_EXCEEDS_BALANCE: {
    status: 409,
    message: "errors.payment_exceeds_balance",
  },
  PAYMENT_NOT_FOUND: { status: 404, message: "errors.payment_not_found" },
  PAYMENT_ON_DELIVERY_ALREADY_MARKED: {
    status: 409,
    message: "errors.pod_already_marked",
  },
  PAYMENT_ON_DELIVERY_NOT_MARKED: {
    status: 409,
    message: "errors.pod_not_marked",
  },
  NO_PAYMENT_DUE: { status: 409, message: "errors.no_payment_due" },
  SALE_NOT_FOUND: { status: 404, message: "errors.sale_not_found" },
  SALE_ITEM_REQUIRED: { status: 400, message: "errors.sale_item_required" },
  SALE_PAYMENT_MISMATCH: {
    status: 400,
    message: "errors.sale_payment_mismatch",
  },
  INVALID_WARRANTY_REFERENCE: {
    status: 400,
    message: "errors.invalid_warranty_reference",
  },
  INVALID_TECHNICIAN: { status: 400, message: "errors.invalid_technician" },
  AI_DISABLED: { status: 400, message: "errors.ai_disabled" },
  AI_NOT_CONFIGURED: { status: 400, message: "errors.ai_not_configured" },
  NO_SHOP_PHONE: { status: 400, message: "errors.no_shop_phone" },
  SMS_NOT_CONFIGURED: { status: 400, message: "errors.sms_not_configured" },
  SMS_SEND_FAILED: { status: 502, message: "errors.sms_send_failed" },
  SMS_WEBHOOK_FAILED: { status: 502, message: "errors.sms_webhook_failed" },
  JOB_CODE_OVERFLOW: { status: 500, message: "errors.job_code_overflow" },
  OUTBOX_NOT_QUEUED: { status: 409, message: "errors.outbox_not_queued" },
  CASH_SESSION_ALREADY_CLOSED: {
    status: 409,
    message: "errors.cash_session_already_closed",
  },
  CASH_SESSION_NOT_CLOSED: {
    status: 409,
    message: "errors.cash_session_not_closed",
  },
  BUILTIN_AGENT_DELETE: {
    status: 403,
    message: "errors.builtin_agent_delete",
  },
  FEEDBACK_NOT_CONFIGURED: {
    status: 503,
    message: "errors.feedback_not_configured",
  },
  FEEDBACK_FAILED: { status: 502, message: "errors.feedback_failed" },

  // ── Quotes ─────────────────────────────────────────────────────────────
  QUOTE_NOT_FOUND: { status: 404, message: "errors.quote_not_found" },
  QUOTE_ALREADY_RESPONDED: {
    status: 409,
    message: "errors.quote_already_responded",
  },
  QUOTE_SUPERSEDED: { status: 409, message: "errors.quote_superseded" },

  // ── Server ─────────────────────────────────────────────────────────────
  INTERNAL_ERROR: { status: 500, message: "errors.internal_error" },

  // ── Returns ────────────────────────────────────────────────────────────
  RETURN_CLAIM_NOT_FOUND: {
    status: 404,
    message: "errors.return_claim_not_found",
  },
  RETURN_CLAIM_NOT_OPEN: {
    status: 409,
    message: "errors.return_claim_not_open",
  },
  RETURN_CLAIM_FAULT_REQUIRED: {
    status: 400,
    message: "errors.return_claim_fault_required",
  },
  RETURN_CLAIM_REWORK_JOB_NOT_DELIVERED: {
    status: 409,
    message: "errors.return_claim_rework_job_not_delivered",
  },
  RETURN_CLAIM_REWORK_JOB_REQUIRED: {
    status: 409,
    message: "errors.return_claim_rework_job_required",
  },
  INVALID_CLAIMED_LINE: { status: 400, message: "errors.invalid_claimed_line" },
  REFUND_EXCEEDS_ORIGINAL: {
    status: 400,
    message: "errors.refund_exceeds_original",
  },
  ORIGINAL_JOB_NOT_DELIVERED: {
    status: 409,
    message: "errors.original_job_not_delivered",
  },
  REWORK_JOB_HAS_OPEN_CLAIM: {
    status: 409,
    message: "errors.rework_job_has_open_claim",
  },
  RETURN_CLAIM_HAS_REWORK_JOB: {
    status: 409,
    message: "errors.return_claim_has_rework_job",
  },

  // ── OficinaOS Cloud ────────────────────────────────────────────────────
  CLOUD_UNREACHABLE: { status: 502, message: "errors.cloud_unreachable" },
  CLOUD_NOT_PAIRED: { status: 400, message: "errors.cloud_not_paired" },
  CLOUD_INVALID_CODE: { status: 400, message: "errors.cloud_invalid_code" },
  CLOUD_PAIRING_FAILED: {
    status: 502,
    message: "errors.cloud_pairing_failed",
  },
  CLOUD_TOKEN_REJECTED: {
    status: 502,
    message: "errors.cloud_token_rejected",
  },
  CLOUD_AI_FAILED: {
    status: 502,
    message: "errors.cloud_ai_failed",
  },
  CLOUD_MODULE_REQUIRED: {
    status: 402,
    message: "errors.cloud_module_required",
  },

  // ── Intake requests (public pre-check) ───────────────────────────────────
  INTAKE_REQUEST_NOT_FOUND: {
    status: 404,
    message: "errors.intake_request_not_found",
  },
  INTAKE_REQUEST_NOT_PENDING: {
    status: 409,
    message: "errors.intake_request_not_pending",
  },
  INTAKE_REQUEST_NO_DIAGNOSTIC: {
    status: 400,
    message: "errors.intake_request_no_diagnostic",
  },

  // ── Trade-ins (compra de usados) ─────────────────────────────────────────
  TRADE_IN_NOT_FOUND: {
    status: 404,
    message: "errors.trade_in_not_found",
  },
  TRADE_IN_INVALID_STATE: {
    status: 409,
    message: "errors.trade_in_invalid_state",
  },
  TRADE_IN_SIGNATURE_REQUIRED: {
    status: 400,
    message: "errors.trade_in_signature_required",
  },

  // ── Part-request board (procuro-peça, Pro module: market) ──────────────
  PART_REQUEST_NOT_FOUND: {
    status: 404,
    message: "errors.part_request_not_found",
  },
  RATE_LIMITED: {
    status: 429,
    message: "errors.rate_limited",
  },

  // ── Direct network printing (ESC/POS) ──────────────────────────────────
  PRINTER_NOT_CONFIGURED: {
    status: 400,
    message: "errors.printer_not_configured",
  },
  PRINTER_UNREACHABLE: {
    status: 502,
    message: "errors.printer_unreachable",
  },

  // ── Invoicing (Pro module: invoicing — InvoiceXpress) ──────────────────
  INVOICING_NOT_CONFIGURED: {
    status: 400,
    message: "errors.invoicing_not_configured",
  },
  INVOICING_PROVIDER_FAILED: {
    status: 502,
    message: "errors.invoicing_provider_failed",
  },
  ALREADY_INVOICED: {
    status: 409,
    message: "errors.already_invoiced",
  },
  PASSWORD_CHANGE_REQUIRED: {
    status: 403,
    message: "errors.password_change_required",
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;
