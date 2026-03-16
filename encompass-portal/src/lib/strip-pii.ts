/**
 * PII stripping for Encompass loan objects.
 * Config-driven: edit pii-config.json to add/remove fields.
 * Returns a deep-cleaned clone — never mutates the original.
 */
import piiConfig from "./pii-config.json";

// Pre-build Sets for O(1) lookups
const alwaysPii = new Set(piiConfig.always_pii_fields);
const dropTopLevel = new Set(piiConfig.drop_top_level_keys);
const dropInside: Record<string, Set<string>> = {};
for (const [parent, children] of Object.entries(piiConfig.drop_inside_parent)) {
  dropInside[parent] = new Set(children);
}
const piiCustomFields = new Set(piiConfig.pii_custom_fields);
const volPii = new Set(piiConfig.vol_pii_fields);
const vodItemPii = new Set(piiConfig.vod_item_pii_fields);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function cleanObj(
  obj: Record<string, unknown>,
  parentKey: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const parentDrops = parentKey ? dropInside[parentKey] : undefined;

  for (const [key, val] of Object.entries(obj)) {
    // Rule 1: always-PII fields removed at any depth
    if (alwaysPii.has(key)) continue;

    // Rule 2: parent-specific drops
    if (parentDrops?.has(key)) continue;

    // Rule 3: tax4506Ts removed unconditionally
    if (key === "tax4506Ts") continue;

    // Rule 4: mailingAddress/residences under borrower/coborrower
    if (
      (parentKey === "borrower" || parentKey === "coborrower") &&
      (key === "mailingAddress" || key === "residences")
    ) continue;

    // Rule 5: customFields array — filter by fieldName
    if (key === "customFields" && Array.isArray(val)) {
      out[key] = val.filter(
        (cf) =>
          isPlainObject(cf) &&
          typeof cf.fieldName === "string" &&
          !piiCustomFields.has(cf.fieldName),
      );
      continue;
    }

    // Rule 6: vods — strip items sub-array
    if (key === "vods" && Array.isArray(val)) {
      out[key] = val.map((vod) => {
        if (!isPlainObject(vod)) return vod;
        const cleaned = cleanObj(vod, "vod");
        delete cleaned.items;
        return cleaned;
      });
      continue;
    }

    // Rule 7: vols — per-entry PII fields stripped
    if (key === "vols" && Array.isArray(val)) {
      out[key] = val.map((vol) => {
        if (!isPlainObject(vol)) return vol;
        const cleaned: Record<string, unknown> = {};
        for (const [vk, vv] of Object.entries(vol)) {
          if (volPii.has(vk)) continue;
          if (alwaysPii.has(vk)) continue;
          cleaned[vk] = isPlainObject(vv)
            ? cleanObj(vv, vk)
            : Array.isArray(vv)
              ? vv.map((item) => (isPlainObject(item) ? cleanObj(item, vk) : item))
              : vv;
        }
        return cleaned;
      });
      continue;
    }

    // Rule 8: recurse into remaining children
    if (isPlainObject(val)) {
      out[key] = cleanObj(val, key);
    } else if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        isPlainObject(item) ? cleanObj(item, key) : item,
      );
    } else {
      out[key] = val;
    }
  }

  return out;
}

/**
 * Strip PII from an Encompass loan object.
 * Returns a deep-cleaned clone.
 */
export function stripPii(obj: unknown): unknown {
  if (!isPlainObject(obj)) return obj;

  // Drop top-level keys first
  const filtered: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (dropTopLevel.has(key)) continue;
    filtered[key] = val;
  }

  return cleanObj(filtered, null);
}
