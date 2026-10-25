export const TRADES = ["plumbing", "electrical", "hvac", "appliance", "locksmith", "pest", "roofing", "carpentry", "painting", "general"];
export const tradeLabel = (t: string) => (t === "hvac" ? "HVAC" : t[0].toUpperCase() + t.slice(1));
