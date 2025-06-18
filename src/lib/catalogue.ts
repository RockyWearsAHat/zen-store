export const catalogue = {
  "desktop-fountain": {
    title: "ZenFlow™ Desktop Fountain",
    price: 179.99,
    aliId: "3256808853336519",
    skuAttr: "14:200003699;200007763:201336106",
  },
  // ...add more products here…
} as const;

export type Sku = keyof typeof catalogue;
export type Product = (typeof catalogue)[keyof typeof catalogue];
