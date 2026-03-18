export class SubmitDoSignatureDto {
    recipientName!: string;
    recipientNric?: string;
    signedAt?: string;
    signatureBase64!: string; // data:image/png;base64,... or raw base64
  }