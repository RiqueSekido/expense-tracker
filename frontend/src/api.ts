export type Expense = {
  id: number;
  description: string;
  amount: string;
  date: string;
  category: string;
  kind: 'income' | 'expense';
  devendo_type: 'personal' | 'salary';
  devendo_hidden: boolean;
  personal_expense: boolean;
  reimbursement_for_id: number | null;
  reimbursed_amount: string;
  pending_amount: string;
  split_id: number | null;
  split_description: string | null;
  split_total: string | null;
};
export type NewExpense = Pick<Expense, 'description' | 'amount' | 'date' | 'category' | 'devendo_type'>;
export type SplitPart = Pick<NewExpense, 'description' | 'amount' | 'category' | 'devendo_type'>;
export type ExpenseSplit = {
  payment: { id: number; description: string; amount: string; date: string };
  parts: Expense[];
};
export type Summary = {
  total: string; income: string; balance: string; count: number;
  routine_total: string; reimbursements: string; pending_reimbursement: string;
};
export type Category = { name: string; expense_count: number };
export type ImportCandidate = NewExpense & {
  kind: Expense['kind'];
  row_number: number;
  card_payment: boolean;
  duplicate: boolean;
  source_description: string;
  source_document: string;
};
export type ImportPreview = { candidates: ImportCandidate[]; ignored_rows: number };

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

export async function previewImport(content: ArrayBuffer): Promise<ImportPreview> {
  return request<ImportPreview>('/expenses/import/preview', {
    method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: content,
  });
}
