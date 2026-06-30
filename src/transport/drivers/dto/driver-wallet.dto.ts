/** Driver wallet month summary — shared by admin driver panel and legacy mobile wallet endpoints. */
export interface DriverWalletTransactionDto {
  id: string;
  tripId: string;
  amountCents: number;
  currency: string;
  type: string;
  description: string | null;
  createdAt: Date;
}

export interface DriverWalletDto {
  month: string;
  transactions: DriverWalletTransactionDto[];
  totalCents: number;
}
