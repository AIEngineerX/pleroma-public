export const FINANCIAL_PROMISE = /\b(?:guarantee(?:d)?|returns?|profits?|moon|100x|yield)\b/i;

export const PROHIBITED_FINANCIAL_COPY = [
  "guarantee",
  "guaranteed",
  "return",
  "returns",
  "annual return",
  "profit",
  "profits",
  "moon",
  "to the moon",
  "100x",
  "yield",
  "guaranteed yield",
] as const;
