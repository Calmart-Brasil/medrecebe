import { Directory, File, Paths } from 'expo-file-system';

function evidenceDirectory(): Directory {
  return new Directory(Paths.document, 'attendance-evidence');
}

export async function persistEvidence(sourceUri: string): Promise<string> {
  const directory = evidenceDirectory();
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true });

  const extensionMatch = sourceUri.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? 'jpg';
  const source = new File(sourceUri);
  const target = new File(directory, `atendimento-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
  await source.copy(target);
  return target.uri;
}

export async function clearEvidence(): Promise<void> {
  const directory = evidenceDirectory();
  if (directory.exists) await directory.delete();
}
