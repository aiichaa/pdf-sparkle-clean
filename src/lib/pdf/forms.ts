// Fill interactive PDF forms (AcroForm) with pdf-lib. Pure: no DOM, unit-tested.
//
// The SAME document is kept (like Protect / Unlock / Compress). Values are written
// with pdf-lib's standard Helvetica appearance, so text is limited to WinAnsi
// (Latin-1 + CP1252): accents, €, “quotes” are fine; Arabic, CJK, emoji are not.
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  type PDFField,
} from "@cantoo/pdf-lib";
import { loadPdf, PdfToolError } from "./ops";
import { isWinAnsiChar } from "./winansi";

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "list";
export type FieldValue = string | boolean | string[];

export interface FieldWidget {
  /** 0-based page index */
  page: number;
  /** [x1, y1, x2, y2] in PDF user space */
  rect: [number, number, number, number];
}

export interface FormFieldInfo {
  name: string;
  /** Human label: the field's tooltip (/TU) if present, else a prettified name */
  label: string;
  kind: FieldKind;
  value: FieldValue;
  options?: string[];
  multiline?: boolean;
  maxLength?: number;
  multiSelect?: boolean;
  readOnly: boolean;
  required: boolean;
  widgets: FieldWidget[];
}

export interface FormInfo {
  fields: FormFieldInfo[];
  /** XFA form data present (dynamic Adobe forms can't be filled here) */
  hasXfa: boolean;
  /** Buttons / signature fields we don't touch */
  ignored: number;
}

/** "applicant.first_name[0]" → "First name" */
export function prettifyName(name: string): string {
  const last = name.split(".").pop() ?? name;
  const words = last
    .replace(/\[\d+\]$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim();
  if (!words) return name;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function tooltip(field: PDFField): string | undefined {
  const tu = field.acroField.dict.get(PDFName.of("TU"));
  if (tu instanceof PDFString || tu instanceof PDFHexString) {
    const t = tu.decodeText().trim();
    return t || undefined;
  }
  return undefined;
}

function kindOf(field: PDFField): FieldKind | null {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "list";
  return null; // push buttons, signature fields
}

function widgetsOf(doc: PDFDocument, field: PDFField): FieldWidget[] {
  const pages = doc.getPages();
  const pageIndexByRef = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const out: FieldWidget[] = [];
  for (const w of field.acroField.getWidgets()) {
    let page = w.P() ? pageIndexByRef.get(w.P()!.toString()) : undefined;
    if (page === undefined) {
      // /P is optional: find the page whose /Annots lists this widget.
      const ref = doc.context.getObjectRef(w.dict);
      page = pages.findIndex((p) => {
        const annots = p.node.Annots();
        if (!annots || !ref) return false;
        for (let i = 0; i < annots.size(); i++)
          if (annots.get(i).toString() === ref.toString()) return true;
        return false;
      });
      if (page < 0) continue;
    }
    const r = w.getRectangle();
    out.push({ page, rect: [r.x, r.y, r.x + r.width, r.y + r.height] });
  }
  return out;
}

export async function readForm(bytes: Uint8Array, name?: string): Promise<FormInfo> {
  await loadPdf(bytes, name); // friendly errors for encrypted / broken files
  const doc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    throwOnInvalidObject: false,
    preserveXFA: true,
  });
  const form = doc.getForm();
  const fields: FormFieldInfo[] = [];
  let ignored = 0;
  for (const f of form.getFields()) {
    const kind = kindOf(f);
    if (!kind) {
      ignored++;
      continue;
    }
    const base = {
      name: f.getName(),
      label: tooltip(f) ?? prettifyName(f.getName()),
      kind,
      readOnly: f.isReadOnly(),
      required: f.isRequired(),
      widgets: widgetsOf(doc, f),
    };
    if (f instanceof PDFTextField) {
      fields.push({
        ...base,
        value: f.getText() ?? "",
        multiline: f.isMultiline(),
        maxLength: f.getMaxLength(),
      });
    } else if (f instanceof PDFCheckBox) {
      fields.push({ ...base, value: f.isChecked() });
    } else if (f instanceof PDFRadioGroup) {
      fields.push({ ...base, value: f.getSelected() ?? "", options: f.getOptions() });
    } else if (f instanceof PDFDropdown) {
      fields.push({ ...base, value: f.getSelected()[0] ?? "", options: f.getOptions() });
    } else if (f instanceof PDFOptionList) {
      fields.push({
        ...base,
        value: f.getSelected(),
        options: f.getOptions(),
        multiSelect: f.isMultiselect(),
      });
    }
  }
  return { fields, hasXfa: form.hasXFA(), ignored };
}

/** Keep line breaks (multiline fields); replace what Helvetica can't draw. */
export function sanitizeFieldText(
  s: string,
  multiline: boolean,
): { text: string; replaced: boolean } {
  let text = "";
  let replaced = false;
  for (const ch of s.replace(/\r\n?/g, "\n")) {
    if (ch === "\n") text += multiline ? "\n" : " ";
    else if (ch === "\t") text += " ";
    else if (isWinAnsiChar(ch)) text += ch;
    else {
      text += "?";
      replaced = true;
    }
  }
  return { text, replaced };
}

/**
 * Multiline text with an "auto" (0 Tf) or absurdly large baked-in size renders as
 * one giant word. Widgets may carry their own /DA, so check those too.
 */
function needsReadableSize(f: PDFTextField): boolean {
  const das = [
    f.acroField.getDefaultAppearance(),
    ...f.acroField.getWidgets().map((w) => {
      const da = w.dict.get(PDFName.of("DA"));
      return da instanceof PDFString || da instanceof PDFHexString ? da.decodeText() : undefined;
    }),
  ].filter((d): d is string => !!d);
  const sizes = das
    .map((d) => /(\d+(?:\.\d+)?)\s+Tf/.exec(d)?.[1])
    .filter(Boolean)
    .map(Number);
  return !sizes.length || sizes.some((n) => n === 0 || n > 24);
}

export async function fillForm(
  bytes: Uint8Array,
  values: Record<string, FieldValue>,
  { flatten = false, name }: { flatten?: boolean; name?: string } = {},
): Promise<{ bytes: Uint8Array; replacedChars: boolean; changed: number }> {
  // Default load strips XFA, so viewers show the AcroForm values we write.
  const doc = await loadPdf(bytes, name);
  const form = doc.getForm();
  if (!form.getFields().length) throw new PdfToolError("empty", "This PDF has no fillable fields.");
  let replacedChars = false;
  let changed = 0;
  for (const [fieldName, value] of Object.entries(values)) {
    const f = form.getFieldMaybe(fieldName);
    if (!f || f.isReadOnly()) continue;
    if (f instanceof PDFTextField && typeof value === "string") {
      const { text, replaced } = sanitizeFieldText(value, f.isMultiline());
      replacedChars ||= replaced;
      const max = f.getMaxLength();
      const next = max !== undefined ? text.slice(0, max) : text;
      if ((f.getText() ?? "") !== next) {
        // Use a normal 10pt for multiline text like Acrobat does (see needsReadableSize).
        if (f.isMultiline() && needsReadableSize(f)) f.setFontSize(10);
        f.setText(next || undefined);
        changed++;
      }
    } else if (f instanceof PDFCheckBox && typeof value === "boolean") {
      if (f.isChecked() !== value) {
        if (value) f.check();
        else f.uncheck();
        changed++;
      }
    } else if (f instanceof PDFRadioGroup && typeof value === "string") {
      if ((f.getSelected() ?? "") !== value) {
        if (value && f.getOptions().includes(value)) f.select(value);
        else if (!value) f.clear();
        changed++;
      }
    } else if (f instanceof PDFDropdown && typeof value === "string") {
      if ((f.getSelected()[0] ?? "") !== value) {
        if (value) f.select(value);
        else f.clear();
        changed++;
      }
    } else if (f instanceof PDFOptionList && Array.isArray(value)) {
      const cur = f.getSelected();
      if (cur.length !== value.length || cur.some((v, i) => v !== value[i])) {
        const allowed = value.filter((v) => f.getOptions().includes(v));
        if (allowed.length) f.select(f.isMultiselect() ? allowed : allowed[0]);
        else f.clear();
        changed++;
      }
    }
  }
  if (flatten) form.flatten();
  return { bytes: await doc.save({ useObjectStreams: true }), replacedChars, changed };
}
