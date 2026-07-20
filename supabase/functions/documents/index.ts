import { json, options, publicError } from '../_shared/http.ts';
import { adminClient, authenticatedUser, authenticationStatus } from '../_shared/supabase.ts';

const BUCKET = 'medrecebe-documents';
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60 * 60;
const DOCUMENT_TYPES = new Set(['attendance_evidence', 'invoice']);
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

type DocumentRow = {
  id: string;
  record_id: string;
  document_type: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string;
  storage_path: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function safeIdentifier(value: unknown, label: string): string {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function safeFileName(value: unknown): string {
  const normalized = String(value || 'documento').replace(/[\u0000-\u001f\\/]+/g, ' ').trim().slice(0, 180);
  if (!normalized) throw new Error('Nome do arquivo inválido.');
  return normalized;
}

function decodeBase64(value: unknown): Uint8Array {
  const encoded = String(value || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!encoded || encoded.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) throw new Error('Arquivo ausente ou maior que 10 MB.');
  let decoded = '';
  try {
    decoded = atob(encoded);
  } catch {
    throw new Error('Conteúdo do arquivo inválido.');
  }
  if (!decoded.length || decoded.length > MAX_BYTES) throw new Error('O arquivo deve ter no máximo 10 MB.');
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function withSignedUrl(admin: ReturnType<typeof adminClient>, row: DocumentRow) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return {
    id: row.id,
    recordId: row.record_id,
    documentType: row.document_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    signedUrl: data.signedUrl,
    signedUrlExpiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(),
  };
}

async function ensureActiveAccess(admin: ReturnType<typeof adminClient>, userId: string): Promise<void> {
  const { data, error } = await admin.from('profiles').select('role, access_status').eq('id', userId).single();
  if (error || !data) throw new Error('Conta não encontrada.');
  if (data.role !== 'admin' && data.access_status !== 'active') throw new Error('Acesso inativo.');
}

Deno.serve(async (request) => {
  const preflight = options(request);
  if (preflight) return preflight;
  if (request.method !== 'POST') return publicError(request, 'Método não permitido.', 405);

  try {
    const user = await authenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'list');
    const admin = adminClient();
    await ensureActiveAccess(admin, user.id);

    if (action === 'list') {
      const { data, error } = await admin
        .from('user_documents')
        .select('id, record_id, document_type, file_name, mime_type, size_bytes, checksum_sha256, storage_path, status, created_at, updated_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const documents = await Promise.all(((data || []) as DocumentRow[]).map((row) => withSignedUrl(admin, row)));
      return json(request, { documents });
    }

    if (action === 'upload') {
      const documentId = safeIdentifier(body.documentId, 'Identificador do documento');
      const recordId = safeIdentifier(body.recordId, 'Identificador do registro');
      const documentType = String(body.documentType || '');
      if (!DOCUMENT_TYPES.has(documentType)) throw new Error('Tipo de documento inválido.');
      const mimeType = String(body.mimeType || '').toLowerCase();
      const extension = MIME_EXTENSIONS[mimeType];
      if (!extension) throw new Error('Formato de arquivo não permitido.');
      const fileName = safeFileName(body.fileName);
      const bytes = decodeBase64(body.dataBase64);
      const storagePath = `${user.id}/${recordId}/${documentId}.${extension}`;
      const sha256 = await checksum(bytes);

      const { data: previous } = await admin
        .from('user_documents')
        .select('storage_path')
        .eq('id', documentId)
        .eq('user_id', user.id)
        .maybeSingle();

      const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: true,
      });
      if (uploadError) throw uploadError;

      const { data, error } = await admin
        .from('user_documents')
        .upsert({
          id: documentId,
          user_id: user.id,
          record_id: recordId,
          document_type: documentType,
          file_name: fileName,
          mime_type: mimeType,
          size_bytes: bytes.length,
          checksum_sha256: sha256,
          storage_path: storagePath,
          status: 'ready',
        }, { onConflict: 'user_id,id' })
        .select('id, record_id, document_type, file_name, mime_type, size_bytes, checksum_sha256, storage_path, status, created_at, updated_at')
        .single();
      if (error) throw error;

      if (previous?.storage_path && previous.storage_path !== storagePath) {
        await admin.storage.from(BUCKET).remove([previous.storage_path]);
      }
      return json(request, { document: await withSignedUrl(admin, data as DocumentRow) });
    }

    if (action === 'delete-record') {
      const recordId = safeIdentifier(body.recordId, 'Identificador do registro');
      const { data, error } = await admin
        .from('user_documents')
        .select('storage_path')
        .eq('user_id', user.id)
        .eq('record_id', recordId);
      if (error) throw error;
      const paths = (data || []).map((item) => String(item.storage_path)).filter(Boolean);
      if (paths.length) {
        const { error: storageError } = await admin.storage.from(BUCKET).remove(paths);
        if (storageError) throw storageError;
      }
      const { error: deleteError } = await admin
        .from('user_documents')
        .delete()
        .eq('user_id', user.id)
        .eq('record_id', recordId);
      if (deleteError) throw deleteError;
      return json(request, { deleted: true, count: paths.length });
    }

    return publicError(request, 'Ação inválida.');
  } catch (error) {
    console.error('documents', error);
    const message = error instanceof Error ? error.message : 'Não foi possível processar o documento.';
    const status = message === 'Acesso inativo.' ? 403 : authenticationStatus(error, 500);
    return publicError(request, status === 403 ? 'Acesso inativo.' : 'Não foi possível processar o documento.', status);
  }
});
