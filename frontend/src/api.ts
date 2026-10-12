export type Expense = {
  id: number;
  description: string;
  amount: string;
  date: string;
  category: string;
};
export type NewExpense = Omit<Expense, 'id'>;
export type Summary = { total: string; count: number };

const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8050/api';

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string'
      ? body.detail
      : response.status === 422
        ? 'Confira os campos: use um valor positivo com até duas casas decimais.'
        : 'Não foi possível concluir a operação. Tente novamente.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
