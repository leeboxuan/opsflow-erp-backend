import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  assertGeneratedFrozenArtifact,
  assertInvoiceTransition,
  canGenerateInvoice,
  canIssueInvoice,
  canMarkInvoicePaid,
  canTransitionInvoice,
  canVoidInvoice,
  frozenInvoiceArtifactIsConsistent,
  hasFrozenInvoiceArtifact,
  INVOICE_STATUS,
  INVOICE_TRANSITIONS,
  invoiceCannotRevertToDraftMessage,
  isInvoiceDraft,
  isInvoiceEditable,
  isInvoiceFrozen,
  isInvoiceGenerated,
  isInvoiceIssued,
  isInvoicePaid,
  isInvoiceRecognized,
  isInvoiceReserving,
  isInvoiceVoid,
  type InvoiceStatusValue,
} from "./invoice-status";

const ALL_STATUSES = Object.values(INVOICE_STATUS) as InvoiceStatusValue[];

describe("canonical invoice status transitions", () => {
  it("enumerates every status pair against the allowed matrix", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const allowed = INVOICE_TRANSITIONS[from].includes(to);
        expect(canTransitionInvoice(from, to)).toBe(allowed);
      }
    }
    expect(canTransitionInvoice("GENERATED", "DRAFT")).toBe(false);
    expect(canTransitionInvoice("ISSUED", "DRAFT")).toBe(false);
    expect(canTransitionInvoice("DRAFT", "ISSUED")).toBe(false);
    expect(canTransitionInvoice("GENERATED", "PAID")).toBe(false);
    expect(canTransitionInvoice("PAID", "VOID")).toBe(false);
    expect(canTransitionInvoice("DRAFT", "DRAFT")).toBe(false);
  });

  it("classifies DRAFT GENERATED ISSUED PAID VOID without Sent or revert", () => {
    expect(isInvoiceDraft("DRAFT")).toBe(true);
    expect(isInvoiceGenerated("GENERATED")).toBe(true);
    expect(isInvoiceIssued("ISSUED")).toBe(true);
    expect(isInvoiceIssued("Sent")).toBe(false);
    expect(isInvoiceRecognized("GENERATED")).toBe(false);
    expect(isInvoiceRecognized("ISSUED")).toBe(true);
    expect(isInvoiceReserving("GENERATED")).toBe(true);
    expect(isInvoiceReserving("VOID")).toBe(false);
    expect(isInvoiceFrozen("GENERATED")).toBe(true);
    expect(isInvoiceEditable("DRAFT")).toBe(true);
    expect(isInvoiceEditable("GENERATED")).toBe(false);
    expect(isInvoiceEditable("ISSUED")).toBe(false);
    expect(isInvoicePaid("PAID")).toBe(true);
    expect(isInvoiceVoid("VOID")).toBe(true);
  });

  it("allows generate only from DRAFT and issue only from GENERATED", () => {
    expect(canGenerateInvoice("DRAFT")).toBe(true);
    expect(canGenerateInvoice("GENERATED")).toBe(false);
    expect(canGenerateInvoice("ISSUED")).toBe(false);
    expect(canGenerateInvoice("PAID")).toBe(false);
    expect(canGenerateInvoice("VOID")).toBe(false);
    expect(canIssueInvoice("GENERATED")).toBe(true);
    expect(canIssueInvoice("DRAFT")).toBe(false);
    expect(canMarkInvoicePaid("ISSUED")).toBe(true);
    expect(canMarkInvoicePaid("GENERATED")).toBe(false);
    expect(canVoidInvoice("PAID")).toBe(false);
  });

  it("rejects GENERATED/ISSUED revert to DRAFT with a typed 400", () => {
    expect(() => assertInvoiceTransition("GENERATED", "DRAFT")).toThrow(
      BadRequestException,
    );
    expect(() => assertInvoiceTransition("ISSUED", "DRAFT")).toThrow(
      BadRequestException,
    );
    expect(invoiceCannotRevertToDraftMessage()).toMatch(/cannot revert/);
  });

  it("fails closed when GENERATED metadata is incomplete or inconsistent", () => {
    expect(hasFrozenInvoiceArtifact({ pdfKey: "k", pdfGeneratedAt: new Date() })).toBe(
      true,
    );
    expect(
      frozenInvoiceArtifactIsConsistent({
        pdfKey: "k",
        pdfGeneratedAt: new Date(),
        documentStorageKey: "other",
      }),
    ).toBe(false);
    expect(() =>
      assertGeneratedFrozenArtifact({
        status: "GENERATED",
        pdfKey: null,
        pdfGeneratedAt: new Date(),
      }),
    ).toThrow(ConflictException);
    expect(() =>
      assertGeneratedFrozenArtifact({
        status: "GENERATED",
        pdfKey: "k",
        pdfGeneratedAt: new Date(),
        documentStorageKey: "k",
      }),
    ).not.toThrow();
  });
});
