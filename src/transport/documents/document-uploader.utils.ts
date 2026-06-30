/** Prisma include for resolving uploader name/email on job/trip documents. */
export const documentUploadedByInclude = {
  uploadedBy: {
    select: {
      id: true,
      name: true,
      displayName: true,
      email: true,
    },
  },
} as const;

export function resolveUserDisplayName(
  user:
    | {
        name?: string | null;
        displayName?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!user) return null;
  const name = String(user.name ?? "").trim();
  if (name) return name;
  const displayName = String(user.displayName ?? "").trim();
  if (displayName) return displayName;
  const email = String(user.email ?? "").trim();
  return email || null;
}

export async function loadUploadActorFields(
  prisma: any,
  userId: string | null | undefined,
  user?: { name?: string | null; email?: string | null },
): Promise<{
  uploadedByUserId: string | null;
  uploadedByNameSnapshot: string | null;
}> {
  if (!userId) {
    return { uploadedByUserId: null, uploadedByNameSnapshot: null };
  }
  const fromRequest = user?.name?.trim() || user?.email?.trim() || null;
  if (fromRequest) {
    return { uploadedByUserId: userId, uploadedByNameSnapshot: fromRequest };
  }
  if (!prisma?.user?.findUnique) {
    return { uploadedByUserId: userId, uploadedByNameSnapshot: null };
  }
  const dbUser = (await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, displayName: true, email: true },
  })) as {
    name: string | null;
    displayName: string | null;
    email: string;
  } | null;
  return {
    uploadedByUserId: userId,
    uploadedByNameSnapshot: resolveUserDisplayName(dbUser),
  };
}

export function resolveDocumentUploadedByFields(doc: {
  uploadedByUserId?: string | null;
  uploadedByName?: string | null;
  uploadedByNameSnapshot?: string | null;
  uploadedByEmail?: string | null;
  generatedBySystem?: boolean | null;
  createdAt: Date;
  uploadedBy?: {
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null;
}): {
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
  uploadedAt: Date;
} {
  const uploadedByUserId = doc.uploadedByUserId ?? null;
  const uploadedByEmail =
    String(doc.uploadedBy?.email ?? doc.uploadedByEmail ?? "").trim() || null;
  const fromJoin = resolveUserDisplayName(doc.uploadedBy);
  const fromSnapshot = String(
    doc.uploadedByName ?? doc.uploadedByNameSnapshot ?? "",
  ).trim();
  const uploadedByName =
    fromJoin
    || fromSnapshot
    || uploadedByEmail
    || (doc.generatedBySystem ? "System" : null);

  return {
    uploadedByUserId,
    uploadedByName,
    uploadedByEmail,
    uploadedAt: doc.createdAt,
  };
}
