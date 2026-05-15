const MATERIAL_LIMIT = 3;

export function parseCampaignMediaUrls(value) {
  if (Array.isArray(value)) {
    return value.map((item) => `${item}`.trim()).filter(Boolean);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed.map((item) => `${item}`.trim()).filter(Boolean);
    }
  } catch {
    // Fallback for comma or newline separated values from older records.
  }

  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMaterialType(type) {
  if (type === "document" || type === "media" || type === "link") {
    return type;
  }

  return "link";
}

function createEmptyMaterial() {
  return {
    label: "",
    type: "link",
    url: "",
    downloadable: false,
  };
}

export function parseCampaignMaterials(value, fallbackUrls = []) {
  const fallbackMaterials = parseCampaignMediaUrls(fallbackUrls).map((url, index) => ({
    label: `Campaign Material ${index + 1}`,
    type: "link",
    url,
    downloadable: false,
  }));

  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (typeof item === "string") {
          return {
            label: `Campaign Material ${index + 1}`,
            type: "link",
            url: item.trim(),
            downloadable: false,
          };
        }

        if (!item || typeof item !== "object") {
          return null;
        }

        return {
          label: `${item.label || `Campaign Material ${index + 1}`}`.trim(),
          type: normalizeMaterialType(item.type),
          url: `${item.url || ""}`.trim(),
          downloadable: Boolean(item.downloadable),
        };
      })
      .filter((item) => item?.url);
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parseCampaignMaterials(parsed, fallbackUrls);
    } catch {
      return parseCampaignMaterials([], value);
    }
  }

  return fallbackMaterials;
}

export function createCampaignMaterialsDraft(materials = [], fallbackUrls = []) {
  const cleaned = parseCampaignMaterials(materials, fallbackUrls).slice(
    0,
    MATERIAL_LIMIT
  );

  while (cleaned.length < MATERIAL_LIMIT) {
    cleaned.push(createEmptyMaterial());
  }

  return cleaned;
}

export function normalizeCampaignMaterialsInput(materials = []) {
  return materials
    .map((item, index) => ({
      label: `${item.label || `Campaign Material ${index + 1}`}`.trim(),
      type: normalizeMaterialType(item.type),
      url: `${item.url || ""}`.trim(),
      downloadable: Boolean(item.downloadable),
    }))
    .filter((item) => item.url)
    .slice(0, MATERIAL_LIMIT);
}

export function createCampaignMediaDraft(urls = []) {
  const cleaned = parseCampaignMediaUrls(urls).slice(0, MATERIAL_LIMIT);

  while (cleaned.length < MATERIAL_LIMIT) {
    cleaned.push("");
  }

  return cleaned;
}

export function normalizeCampaignMediaInput(urls = []) {
  return urls
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MATERIAL_LIMIT);
}
