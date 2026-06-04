export type ParsedAgentMetadata = {
  name: string;
  description: string;
  tags: string[];
  category?: string;
  validated?: boolean;
  pricingMode?: string;
  primaryToken?: string;
  deliveryDescription?: string;
};

export function decodeAgentURI(uri: string): string {
  if (uri.startsWith("data:application/json;base64,")) {
    return atob(uri.slice("data:application/json;base64,".length));
  }

  if (uri.startsWith("data:application/json;utf8,")) {
    return decodeURIComponent(uri.slice("data:application/json;utf8,".length));
  }

  return uri;
}

export function parseAgentMetadata(uri: string): ParsedAgentMetadata | null {
  const decoded = decodeAgentURI(uri);

  try {
    const parsed = JSON.parse(decoded) as {
      name?: string;
      description?: string;
      tags?: unknown[];
      category?: string;
      validated?: boolean;
      pricingMode?: string;
      primaryToken?: string;
      deliveryDescription?: string;
    };

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
      : typeof parsed.category === "string"
        ? [parsed.category]
        : [];

    return {
      name: parsed.name || "Unnamed agent",
      description: parsed.description || "",
      tags,
      category: parsed.category,
      validated: Boolean(parsed.validated),
      pricingMode: parsed.pricingMode,
      primaryToken: parsed.primaryToken,
      deliveryDescription: parsed.deliveryDescription,
    };
  } catch {
    return null;
  }
}

export function parseAgentNameFromURI(uri: string): string | undefined {
  const parsed = parseAgentMetadata(uri);
  return parsed?.name;
}
