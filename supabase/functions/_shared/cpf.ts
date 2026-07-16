export function onlyDigits(value = ''): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export async function cpfHash(value: string): Promise<string> {
  const pepper = Deno.env.get('CPF_PEPPER');
  if (!pepper) throw new Error('CPF_PEPPER não configurado');
  const bytes = new TextEncoder().encode(`${pepper}:${onlyDigits(value)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
