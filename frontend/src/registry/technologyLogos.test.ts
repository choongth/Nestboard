/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOX_BACKGROUND, NOTE_BACKGROUND } from "@/canvas/boxStyle";
import { boxTypes } from "./boxTypes";
import {
  contrastRatio,
  hasNamedLogo,
  MAKER_LOGOS,
  monogram,
  NO_LOGO,
  readableColor,
  technologyMark,
} from "./technologyLogos";

// The box background the logo sits on, read from the theme.
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const BOX = css.match(/--color-surface-raised:\s*(#[0-9a-f]{6})/i)![1]!;

describe("technologyMark", () => {
  it("shows nothing when no technology is set", () => {
    expect(technologyMark(undefined)).toBeNull();
    expect(technologyMark("   ")).toBeNull();
  });

  it("finds logos by name, loosely", () => {
    for (const written of ["PostgreSQL", "postgres", "Postgres", "PG", "PostgreSQL 16"]) {
      expect(technologyMark(written), written).toMatchObject({ kind: "logo", title: "PostgreSQL" });
    }
    expect(technologyMark("k8s")).toMatchObject({ kind: "logo", title: "Kubernetes" });
    expect(technologyMark("Spring Boot")).toMatchObject({ kind: "logo", title: "Spring Boot" });
    expect(technologyMark("Redis Cluster")).toMatchObject({ kind: "logo", title: "Redis" });
  });

  it("falls back to a monogram for technologies without a logo", () => {
    expect(technologyMark("HAProxy")).toEqual({ kind: "monogram", text: "HA" });
    expect(technologyMark("Billing Engine")).toEqual({ kind: "monogram", text: "BE" });
  });

  it("draws brands simple-icons lacks in full colour, and some with their maker's logo", () => {
    expect(technologyMark("AWS Lambda")).toEqual({ kind: "color", title: "AWS Lambda", key: "aws-lambda" });
    expect(technologyMark("Azure SQL Database")).toMatchObject({ kind: "color", key: "microsoft-azure" });
    expect(technologyMark("GCS")).toMatchObject({ kind: "logo", title: "Google Cloud" });
  });

  it("gives every listed technology its own logo or its maker's, unless it is listed as having none", () => {
    const listed = [...new Set(boxTypes.types.flatMap((t) => t.suggestedTechnologies ?? []))];
    for (const name of listed) {
      if (NO_LOGO.includes(name)) expect(technologyMark(name)?.kind, name).toBe("monogram");
      else expect(hasNamedLogo(name), `${name}: give it a logo, a maker in MAKER_LOGOS, or add it to NO_LOGO`).toBe(true);
    }
    // Both lists are about listed technologies only, so the doc stays about them.
    for (const name of [...Object.keys(MAKER_LOGOS), ...NO_LOGO]) expect(listed, name).toContain(name);
  });

  it.each(["technology-logos.md", "technology-logos.zh-CN.md"])(
    "is documented: each borrowed logo, and each technology with none, is in docs/%s",
    (file) => {
      const doc = readFileSync(new URL(`../../../docs/${file}`, import.meta.url), "utf8");
      for (const [name, maker] of Object.entries(MAKER_LOGOS)) expect(doc, name).toContain(`| ${name} | ${maker} |`);
      for (const name of NO_LOGO) expect(doc, name).toContain(`| ${name} |`);
    },
  );
});

describe("box colours used for logo contrast", () => {
  it("match the theme", () => {
    expect(BOX_BACKGROUND).toBe(BOX);
    expect(NOTE_BACKGROUND).toBe(css.match(/--color-note:\s*(#[0-9a-f]{6})/i)![1]);
  });
});

describe("monogram", () => {
  it("uses the first letters of two words, or the first two letters of one", () => {
    expect(monogram("HAProxy")).toBe("HA");
    expect(monogram("Amazon SQS")).toBe("AS");
    expect(monogram("sqs")).toBe("SQ");
    expect(monogram("--")).toBe("?");
  });
});

describe("readableColor", () => {
  it("keeps readable colours and lightens dark ones just enough", () => {
    expect(readableColor("#ff4438", BOX)).toBe("#ff4438");
    const lifted = readableColor("#000000", BOX);
    expect(contrastRatio(lifted, BOX)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(lifted, BOX)).toBeLessThan(4); // not pushed all the way to white
  });
});
