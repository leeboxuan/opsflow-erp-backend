import {
  WarehouseJobDocumentReviewStatus,
  WarehouseJobDocumentType,
  WarehouseJobStatus,
} from '@prisma/client';
import {
  computeWarehouseJobProgress,
  computeWarehouseJobReadiness,
} from './warehouse-job-report-readiness';

describe('computeWarehouseJobReadiness', () => {
  function readyDocuments() {
    return [
      {
        type: WarehouseJobDocumentType.WAREHOUSE_PHOTO,
        reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
      },
      {
        type: WarehouseJobDocumentType.PACKING_LIST,
        reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
      },
    ];
  }

  function baseInput(
    overrides: Partial<Parameters<typeof computeWarehouseJobReadiness>[0]> = {},
  ) {
    return {
      status: WarehouseJobStatus.COMPLETED,
      containerNumber: 'CONT-1',
      sealNumber: null,
      warehouseNotes: null,
      documents: readyDocuments(),
      ...overrides,
    };
  }

  it('hasPackingList true when PACKING_LIST not rejected', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        documents: [
          {
            type: WarehouseJobDocumentType.PACKING_LIST,
            reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
          },
        ],
      }),
    );
    expect(result.hasPackingList).toBe(true);
  });

  it('hasDeliveryOrder true when DELIVERY_ORDER not rejected', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        documents: [
          {
            type: WarehouseJobDocumentType.DELIVERY_ORDER,
            reviewStatus: WarehouseJobDocumentReviewStatus.PENDING_REVIEW,
          },
        ],
      }),
    );
    expect(result.hasDeliveryOrder).toBe(true);
  });

  it('rejected PACKING_LIST does not satisfy hasPackingList', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        documents: [
          {
            type: WarehouseJobDocumentType.PACKING_LIST,
            reviewStatus: WarehouseJobDocumentReviewStatus.REJECTED,
          },
        ],
      }),
    );
    expect(result.hasPackingList).toBe(false);
  });

  it('readyForReport false when job not completed', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({ status: WarehouseJobStatus.IN_PROGRESS }),
    );
    expect(result.readyForReport).toBe(false);
    expect(result.blockers.some((b) => b.code === 'JOB_NOT_COMPLETED')).toBe(
      true,
    );
  });

  it('readyForReport false when no documents', () => {
    const result = computeWarehouseJobReadiness(baseInput({ documents: [] }));
    expect(result.readyForReport).toBe(false);
    expect(result.blockers.some((b) => b.code === 'NO_DOCUMENTS')).toBe(true);
  });

  it('readyForReport false when pending review documents exist', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        documents: [
          {
            type: WarehouseJobDocumentType.WAREHOUSE_PHOTO,
            reviewStatus: WarehouseJobDocumentReviewStatus.PENDING_REVIEW,
          },
        ],
      }),
    );
    expect(result.readyForReport).toBe(false);
    expect(
      result.blockers.some((b) => b.code === 'PENDING_DOCUMENT_REVIEW'),
    ).toBe(true);
  });

  it('readyForReport false when rejected documents exist', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        documents: [
          {
            type: WarehouseJobDocumentType.WAREHOUSE_PHOTO,
            reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
          },
          {
            type: WarehouseJobDocumentType.OTHER,
            reviewStatus: WarehouseJobDocumentReviewStatus.REJECTED,
          },
        ],
      }),
    );
    expect(result.readyForReport).toBe(false);
    expect(result.blockers.some((b) => b.code === 'REJECTED_DOCUMENTS')).toBe(
      true,
    );
  });

  it('readyForReport false when missing execution details', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        containerNumber: null,
        sealNumber: null,
        warehouseNotes: null,
      }),
    );
    expect(result.readyForReport).toBe(false);
    expect(
      result.blockers.some((b) => b.code === 'MISSING_EXECUTION_DETAILS'),
    ).toBe(true);
  });

  it('readyForReport false when missing warehouse/completion photo', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        documents: [
          {
            type: WarehouseJobDocumentType.PACKING_LIST,
            reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
          },
        ],
      }),
    );
    expect(result.readyForReport).toBe(false);
    expect(
      result.blockers.some(
        (b) => b.code === 'MISSING_WAREHOUSE_OR_COMPLETION_PHOTO',
      ),
    ).toBe(true);
  });

  it('readyForReport true when all criteria met', () => {
    const result = computeWarehouseJobReadiness(baseInput());
    expect(result.readyForReport).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('accepts completion photo instead of warehouse photo', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        documents: [
          {
            type: WarehouseJobDocumentType.COMPLETION_PHOTO,
            reviewStatus: WarehouseJobDocumentReviewStatus.APPROVED,
          },
        ],
      }),
    );
    expect(result.readyForReport).toBe(true);
  });

  it('hasExecutionDetails true with seal number only', () => {
    const result = computeWarehouseJobReadiness(
      baseInput({
        containerNumber: null,
        warehouseNotes: null,
        sealNumber: 'SEAL-9',
      }),
    );
    expect(result.hasExecutionDetails).toBe(true);
  });
});

describe('computeWarehouseJobProgress', () => {
  it('computes line and unit progress', () => {
    const result = computeWarehouseJobProgress(
      [
        { requestedQty: 10, completedQty: 10 },
        { requestedQty: 5, completedQty: 2 },
      ],
      [{ linkStatus: 'CONFIRMED' }, { linkStatus: 'PLANNED' }],
    );

    expect(result).toEqual({
      lineCount: 2,
      completedLineCount: 1,
      requestedQtyTotal: 15,
      completedQtyTotal: 12,
      progressPercent: 80,
      unitCount: 2,
      confirmedUnitCount: 1,
    });
  });
});
