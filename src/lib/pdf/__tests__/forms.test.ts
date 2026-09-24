// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFDocument, PDFHexString, PDFName, degrees } from "@cantoo/pdf-lib";
import { readForm, fillForm, prettifyName, sanitizeFieldText } from "../forms";

/** Two-page form covering every field type, a tooltip label, a read-only field and a rotated page. */
async function buildForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([600, 800]);
  const p2 = doc.addPage([600, 800]);
  p2.setRotation(degrees(90));
  const form = doc.getForm();
  const name = form.createTextField("applicant.first_name");
  name.addToPage(p1, { x: 50, y: 700, width: 200, height: 20 });
  name.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText("Prénom"));
  const notes = form.createTextField("notes");
  notes.enableMultiline();
  notes.addToPage(p1, { x: 50, y: 500, width: 300, height: 100 });
  const zip = form.createTextField("zip");
  zip.setMaxLength(5);
  zip.addToPage(p1, { x: 50, y: 450, width: 80, height: 20 });
  const agree = form.createCheckBox("agree");
  agree.addToPage(p1, { x: 50, y: 400, width: 15, height: 15 });
  const size = form.createRadioGroup("size");
  size.addOptionToPage("S", p1, { x: 50, y: 350, width: 15, height: 15 });
  size.addOptionToPage("M", p1, { x: 80, y: 350, width: 15, height: 15 });
  size.addOptionToPage("L", p1, { x: 110, y: 350, width: 15, height: 15 });
  const country = form.createDropdown("country");
  country.addOptions(["Morocco", "France", "Spain"]);
  country.addToPage(p2, { x: 50, y: 700, width: 150, height: 20 });
  const langs = form.createOptionList("languages");
  langs.addOptions(["Arabic", "French", "English"]);
  langs.enableMultiselect();
  langs.addToPage(p2, { x: 50, y: 550, width: 150, height: 80 });
  const id = form.createTextField("case_id");
  id.setText("A-001");
  id.enableReadOnly();
  id.addToPage(p2, { x: 50, y: 450, width: 150, height: 20 });
  doc.setTitle("Application");
  return doc.save();
}

describe("readForm", () => {
  it("lists every field with kind, label, options and page", async () => {
    const info = await readForm(await buildForm());
    const by = Object.fromEntries(info.fields.map((f) => [f.name, f]));
    expect(Object.keys(by).sort()).toEqual(
      [
        "agree",
        "applicant.first_name",
        "case_id",
        "country",
        "languages",
        "notes",
        "size",
        "zip",
      ].sort(),
    );
    expect(by["applicant.first_name"].label).toBe("Prénom"); // from /TU
    expect(by["zip"].label).toBe("Zip");
    expect(by["zip"].maxLength).toBe(5);
    expect(by["notes"].multiline).toBe(true);
    expect(by["size"].options).toEqual(["S", "M", "L"]);
    expect(by["size"].widgets).toHaveLength(3);
    expect(by["country"].options).toEqual(["Morocco", "France", "Spain"]);
    expect(by["country"].widgets[0].page).toBe(1);
    expect(by["languages"].multiSelect).toBe(true);
    expect(by["case_id"]).toMatchObject({ readOnly: true, value: "A-001" });
    // pdf-lib grows the widget by half its 1pt border
    const w = by["applicant.first_name"].widgets[0];
    expect(w.page).toBe(0);
    [50, 700, 250, 720].forEach((v, i) => expect(Math.abs(w.rect[i] - v)).toBeLessThanOrEqual(1));
    expect(info.hasXfa).toBe(false);
  });

  it("returns no fields for an ordinary PDF", async () => {
    const d = await PDFDocument.create();
    d.addPage();
    expect((await readForm(await d.save())).fields).toEqual([]);
  });
});

describe("fillForm", () => {
  it("writes every kind of value and keeps the document", async () => {
    const out = await fillForm(await buildForm(), {
      "applicant.first_name": "Aïcha",
      notes: "Line one\nLine two",
      zip: "2000012345",
      agree: true,
      size: "M",
      country: "Morocco",
      languages: ["Arabic", "French"],
      case_id: "HACKED",
    });
    expect(out.replacedChars).toBe(false);
    const f = (await PDFDocument.load(out.bytes)).getForm();
    expect(f.getTextField("applicant.first_name").getText()).toBe("Aïcha");
    expect(f.getTextField("notes").getText()).toBe("Line one\nLine two");
    expect(f.getTextField("zip").getText()).toBe("20000"); // maxLength
    expect(f.getCheckBox("agree").isChecked()).toBe(true);
    expect(f.getRadioGroup("size").getSelected()).toBe("M");
    expect(f.getDropdown("country").getSelected()).toEqual(["Morocco"]);
    expect(f.getOptionList("languages").getSelected()).toEqual(["Arabic", "French"]);
    expect(f.getTextField("case_id").getText()).toBe("A-001"); // read-only untouched
    expect((await PDFDocument.load(out.bytes)).getTitle()).toBe("Application");
    // auto-sized multiline text gets a readable size instead of filling the box
    const da = f.getTextField("notes").acroField.getDefaultAppearance() ?? "";
    expect(da).toMatch(/\b10 Tf/);
  });

  it("reports characters the standard font can't draw", async () => {
    const out = await fillForm(await buildForm(), { "applicant.first_name": "عائشة" });
    expect(out.replacedChars).toBe(true);
    const f = (await PDFDocument.load(out.bytes)).getForm();
    expect(f.getTextField("applicant.first_name").getText()).toBe("?????");
  });

  it("flattens: answers stay visible, fields are gone", async () => {
    const out = await fillForm(
      await buildForm(),
      { "applicant.first_name": "Aicha" },
      { flatten: true },
    );
    expect((await PDFDocument.load(out.bytes)).getForm().getFields()).toHaveLength(0);
  });

  it("refuses PDFs without fields", async () => {
    const d = await PDFDocument.create();
    d.addPage();
    await expect(fillForm(await d.save(), {})).rejects.toMatchObject({ code: "empty" });
  });
});

describe("helpers", () => {
  it("prettifies field names", () => {
    expect(prettifyName("applicant.firstName[0]")).toBe("First name");
    expect(prettifyName("date_of_birth")).toBe("Date of birth");
    expect(prettifyName("Text1")).toBe("Text1");
  });
  it("keeps line breaks only in multiline fields", () => {
    expect(sanitizeFieldText("a\r\nb\tc", true)).toEqual({ text: "a\nb c", replaced: false });
    expect(sanitizeFieldText("a\nb", false)).toEqual({ text: "a b", replaced: false });
    expect(sanitizeFieldText("café ✓", false)).toEqual({ text: "café ?", replaced: true });
  });
});
