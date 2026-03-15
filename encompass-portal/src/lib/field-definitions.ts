// Field definitions from Encompass Mapped Fields.xlsm
// Maps Encompass field IDs to human-readable labels

export interface FieldDef {
  id: string;
  label: string;
  category: string;
}

// Processing Pipeline View Fields
export const PROCESSING_FIELDS: FieldDef[] = [
  { id: "CX.SUM.PTA.PTD.EXTERNAL", label: "PTA/PTD External", category: "Processing" },
  { id: "364", label: "Loan Number", category: "Loan Info" },
  { id: "11", label: "Subject Property Address", category: "Property" },
  { id: "12", label: "Subject Property City", category: "Property" },
  { id: "14", label: "Subject Property State", category: "Property" },
  { id: "15", label: "Subject Property Zip", category: "Property" },
  { id: "13", label: "Subject Property County", category: "Property" },
  { id: "317", label: "Loan Officer", category: "Team" },
  { id: "CX.ONBOARDING.LO", label: "Onboarding LO", category: "Team" },
  { id: "CX.FILE.STATUS", label: "File Status", category: "Status" },
  { id: "CX.SPECIALFILESTATUS", label: "Process Alert", category: "Status" },
  { id: "1401", label: "Loan Program", category: "Loan Info" },
  { id: "19", label: "Loan Purpose", category: "Loan Info" },
  { id: "420", label: "Lien Position", category: "Loan Info" },
  { id: "2", label: "Loan Amount", category: "Loan Info" },
  { id: "CX.BSCLOSEBYDATE", label: "Original COE Date", category: "Dates" },
  { id: "748", label: "Closing Date", category: "Dates" },
  { id: "762", label: "Lock Expiration Date", category: "Dates" },
  { id: "3977", label: "CD Sent Date", category: "Dates" },
  { id: "CX.BSCOMMITMENTDATE", label: "Contingency Date", category: "Dates" },
  { id: "CX.APPR.CONTINGENCY.D", label: "Appraisal Contingency Date", category: "Dates" },
  { id: "CX.SF.APPRAISAL.DUE", label: "Appraisal Due Date", category: "Dates" },
  { id: "CX.OS.STATUS.3", label: "Appraisal Status", category: "Status" },
  { id: "CX.CURRENTMS.COMMENTS", label: "Comments", category: "Notes" },
  { id: "2626", label: "Channel", category: "Loan Info" },
  { id: "362", label: "Loan Processor", category: "Team" },
];

// Branch View Fields
export const BRANCH_FIELDS: FieldDef[] = [
  { id: "1811", label: "Occupancy (P/S/I)", category: "Loan Info" },
  { id: "353", label: "LTV", category: "Ratios" },
  { id: "976", label: "CLTV", category: "Ratios" },
  { id: "3", label: "Note Rate", category: "Pricing" },
  { id: "2218", label: "Buy Price", category: "Pricing" },
  { id: "761", label: "Lock Date", category: "Dates" },
  { id: "CX.CL.WIRE.ORDERED", label: "Wire Ordered", category: "Closing" },
  { id: "CX.CORPORATE.MARGIN", label: "Corporate Margin", category: "Margin" },
  { id: "454", label: "Origination Fees", category: "Fees" },
  { id: "CX.LEAD.SOURCE", label: "Lead Source", category: "Marketing" },
  { id: "CX.LO.MARGIN", label: "LO Margin", category: "Margin" },
  { id: "CX.BRANCH.MARGIN", label: "Branch Margin", category: "Margin" },
  { id: "CX.SECONDARY.MARKET", label: "Secondary Market, Net", category: "Margin" },
  { id: "CX.BRANCH.MARGIN.NET", label: "Branch Margin Net", category: "Margin" },
  { id: "1621", label: "Processing Income", category: "Fees" },
];

// Status flow fields
export const STATUS_FIELDS: FieldDef[] = [
  { id: "CX.KM.LOANOPEN", label: "Loan Opened", category: "Status" },
  { id: "CX.FILE.STATUS", label: "File Status", category: "Status" },
  { id: "CX.STATUS.UW", label: "UW Status", category: "Underwriting" },
  { id: "CX.RESUB.TO.UW", label: "Resubmit to UW", category: "Underwriting" },
  { id: "CX.PRE.APPROVAL.REVIEW", label: "Pre-Approval Review", category: "Status" },
  { id: "CX.UW.PRE.APPROVED", label: "UW Pre-Approved", category: "Underwriting" },
  { id: "CX.SETUP.TEAM.REVIEW", label: "Setup Team Review", category: "Status" },
  { id: "CX.ADVERSE.TYPE", label: "Adverse Action Type", category: "Adverse" },
  { id: "CX.ADVERSE.SUB.DATE", label: "Adverse Action Submit Date", category: "Adverse" },
  { id: "CX.RELEASED.TO.RECORD", label: "Released to Record", category: "Closing" },
  { id: "CX.REVERT.TO.PROC", label: "Revert to Processing", category: "Status" },
  { id: "3142", label: "Application Date", category: "Dates" },
  { id: "745", label: "Application Date (Alt)", category: "Dates" },
];

// Combined for field reader calls
export const ALL_FIELD_IDS = [
  ...new Set([
    ...PROCESSING_FIELDS.map((f) => f.id),
    ...BRANCH_FIELDS.map((f) => f.id),
    ...STATUS_FIELDS.map((f) => f.id),
  ]),
];

export const FIELD_LABEL_MAP: Record<string, string> = {};
for (const f of [...PROCESSING_FIELDS, ...BRANCH_FIELDS, ...STATUS_FIELDS]) {
  FIELD_LABEL_MAP[f.id] = f.label;
}
