/** Maps Encompass pipeline fields to flat DB columns and back. */

const pf = (fields: Record<string, string>, canonical: string, fieldId?: string) =>
  fields[canonical] || (fieldId ? fields[`Fields.${fieldId}`] : "") || "";

/**
 * Normalize Encompass US-format dates to ISO format.
 * Input:  "10/8/2007 5:02:00 PM" or "3/26/2008 9:16:00 AM"
 * Output: "2007-10-08T17:02:00" or "2008-03-26T09:16:00"
 * Also handles already-ISO dates and empty strings.
 */
export function normalizeDate(raw: string): string {
  if (!raw) return "";
  // Already ISO? Return as-is
  if (/^\d{4}-\d{2}/.test(raw)) return raw;
  // Parse US format: M/D/YYYY H:MM:SS AM/PM
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return raw; // Can't parse, return as-is
  const [, m, d, y, hRaw, min, sec, ampm] = match;
  let h = parseInt(hRaw, 10);
  if (ampm) {
    if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
    if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  }
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${String(h).padStart(2, "0")}:${min}:${sec}`;
}

// ── DB row shape ──

export interface DbRow {
  loan_guid: string;
  loan_number: string;
  borrower_first: string;
  borrower_last: string;
  co_borrower_first: string;
  co_borrower_last: string;
  loan_folder: string;
  last_modified: string;
  loan_amount: number;
  loan_status: string;
  date_created: string;
  milestone: string;
  loan_officer: string;
  loan_processor: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  note_rate: number;
  loan_program: string;
  loan_purpose: string;
  lien_position: string;
  channel: string;
  lock_status: string;
  lock_expiration: string;
  closing_date: string;
  application_date: string;
}

// ── Encompass API → DB row ──

export function encompassFieldsToDbRow(
  loanGuid: string,
  fields: Record<string, string>,
): DbRow {
  const f = fields;
  return {
    loan_guid: loanGuid,
    loan_number: f["Loan.LoanNumber"] || "",
    borrower_first: f["Loan.BorrowerFirstName"] || "",
    borrower_last: f["Loan.BorrowerLastName"] || "",
    co_borrower_first: f["Loan.CoBorrowerFirstName"] || "",
    co_borrower_last: f["Loan.CoBorrowerLastName"] || "",
    loan_folder: f["Loan.LoanFolder"] || "",
    last_modified: normalizeDate(f["Loan.LastModified"] || ""),
    loan_amount: parseFloat(f["Loan.LoanAmount"] || "0") || 0,
    loan_status: f["Loan.LoanStatus"] || "",
    date_created: normalizeDate(f["Loan.DateCreated"] || ""),
    milestone: f["Loan.CurrentMilestoneName"] || "",
    loan_officer: f["Loan.LoanOfficerName"] || "",
    loan_processor: f["Loan.LoanProcessorName"] || "",
    property_address: pf(f, "Loan.SubjectPropertyAddress", "11"),
    property_city: pf(f, "Loan.SubjectPropertyCity", "12"),
    property_state: pf(f, "Loan.SubjectPropertyState", "14"),
    property_zip: f["Loan.SubjectPropertyZip"] || "",
    note_rate: parseFloat(pf(f, "Loan.NoteRatePercent", "3") || "0") || 0,
    loan_program: f["Loan.LoanProgram"] || "",
    loan_purpose: f["Loan.LoanPurpose"] || "",
    lien_position: f["Loan.LienPosition"] || "",
    channel: f["Loan.Channel"] || "",
    lock_status: f["Loan.LockStatus"] || "",
    lock_expiration: normalizeDate(f["Loan.LockExpirationDate"] || ""),
    closing_date: normalizeDate(pf(f, "Loan.ClosingDate", "748") || ""),
    application_date: normalizeDate(pf(f, "", "745") || ""),
  };
}

// ── DB row → PipelineRow (API response format) ──

export function dbRowToPipelineRow(row: DbRow): { loanGuid: string; fields: Record<string, string> } {
  return {
    loanGuid: row.loan_guid,
    fields: {
      "Loan.LoanNumber": row.loan_number,
      "Loan.BorrowerFirstName": row.borrower_first,
      "Loan.BorrowerLastName": row.borrower_last,
      "Loan.CoBorrowerFirstName": row.co_borrower_first,
      "Loan.CoBorrowerLastName": row.co_borrower_last,
      "Loan.LoanFolder": row.loan_folder,
      "Loan.LastModified": row.last_modified,
      "Loan.LoanAmount": String(row.loan_amount),
      "Loan.LoanStatus": row.loan_status,
      "Loan.DateCreated": row.date_created,
      "Loan.CurrentMilestoneName": row.milestone,
      "Loan.LoanOfficerName": row.loan_officer,
      "Loan.LoanProcessorName": row.loan_processor,
      "Loan.SubjectPropertyAddress": row.property_address,
      "Loan.SubjectPropertyCity": row.property_city,
      "Loan.SubjectPropertyState": row.property_state,
      "Fields.14": row.property_state,
      "Loan.SubjectPropertyZip": row.property_zip,
      "Loan.NoteRatePercent": String(row.note_rate),
      "Fields.3": String(row.note_rate),
      "Loan.LoanProgram": row.loan_program,
      "Loan.LoanPurpose": row.loan_purpose,
      "Loan.LienPosition": row.lien_position,
      "Loan.Channel": row.channel,
      "Loan.LockStatus": row.lock_status,
      "Loan.LockExpirationDate": row.lock_expiration,
      "Loan.ClosingDate": row.closing_date,
      "Fields.748": row.closing_date,
      "Fields.745": row.application_date,
      "Fields.12": row.property_city,
      "Fields.11": row.property_address,
    },
  };
}

// ── DB row → CompactRow (analytics, no PII) ──

export interface CompactRow {
  guid: string;
  amt: number;
  prog: string;
  purp: string;
  ms: string;
  lo: string;
  lock: string;
  rate: number;
  st: string;
  dt: string;
  lien: string;
  ln: string;
  channel: string;
  closingDate: string;
  lockExp: string;
  modified: string;
}

export function dbRowToCompact(row: DbRow): CompactRow {
  return {
    guid: row.loan_guid,
    amt: row.loan_amount,
    prog: row.loan_program,
    purp: row.loan_purpose,
    ms: row.milestone,
    lo: row.loan_officer,
    lock: row.lock_status,
    rate: row.note_rate,
    st: row.property_state,
    dt: row.date_created,
    lien: row.lien_position,
    ln: row.loan_number,
    channel: row.channel,
    closingDate: row.closing_date,
    lockExp: row.lock_expiration,
    modified: row.last_modified,
  };
}
