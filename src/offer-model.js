export const DEFAULT_DESIGN = {
  colors: {
    background: "#ffffff",
    text: "#24352b",
    accent: "#245b44",
    buttonText: "#ffffff",
  },
  font: "system",
  fontSize: 16,
  radius: 12,
  padding: 24,
  modal: { width: 480, backdropOpacity: 0.5 },
  floating: { width: 320, position: "bottom-right", offset: 20 },
  bar: { position: "top" },
};
export function designWithDefaults(design = {}) {
  return {
    ...DEFAULT_DESIGN,
    ...design,
    colors: { ...DEFAULT_DESIGN.colors, ...design.colors },
    modal: { ...DEFAULT_DESIGN.modal, ...design.modal },
    floating: { ...DEFAULT_DESIGN.floating, ...design.floating },
    bar: { ...DEFAULT_DESIGN.bar, ...design.bar },
  };
}
