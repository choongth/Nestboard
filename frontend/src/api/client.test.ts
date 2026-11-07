import { describe, expect, it } from "vitest";
import { fileNameOf } from "./client";

describe("fileNameOf", () => {
  it("prefers the UTF-8 name, which keeps any script", () => {
    expect(fileNameOf(`attachment; filename="__.pdf"; filename*=UTF-8''%E6%94%AF%E4%BB%98%20Pay.pdf`)).toBe("支付 Pay.pdf");
  });

  it("falls back to the plain name", () => {
    expect(fileNameOf('attachment; filename="Shop.pdf"')).toBe("Shop.pdf");
    expect(fileNameOf(`attachment; filename="Shop.pdf"; filename*=UTF-8''%E0%A4%A`)).toBe("Shop.pdf");
  });

  it("is null without a name", () => {
    expect(fileNameOf(null)).toBeNull();
    expect(fileNameOf("inline")).toBeNull();
  });
});
