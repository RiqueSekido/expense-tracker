import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Container, Dialog, FormControl,
  DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack,
  Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TablePagination,
  Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { previewImport, request, type Category, type Expense, type ExpenseSplit, type ImportCandidate, type NewExpense, type SplitPart, type Summary } from './api';

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const emptyForm = (): NewExpense => ({ description: '', amount: '', date: localDate(), category: '', devendo_type: 'personal' });
const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat('pt-BR', { month: 'short' })
    .format(new Date(2026, index, 1)).replace('.', ''),
}));
const currency = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const amountInCents = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
};
const inputAmountInCents = (amount: string) => /^\d+([.,]\d{1,2})?$/.test(amount)
  ? amountInCents(amount.replace(',', '.')) : null;
const shiftMonth = (value: string, offset: number) => {
  const [year, month] = value.split('-').map(Number);
  const index = year * 12 + month - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
};
const errorMessage = (error: unknown) => error instanceof TypeError
  ? 'Não foi possível conectar à API. Confira se o backend está em execução.'
  : error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';
const isDevendo = (expense: Pick<Expense, 'category'>) => expense.category.trim().toLocaleLowerCase('pt-BR') === 'devendo';
type TransactionTable = 'net' | 'all' | 'devendo' | 'salary';
type PaginatedTable = TransactionTable | 'categories' | 'import' | 'chart';
const rowsPerPage = 10;
type SortColumn = 'description' | 'kind' | 'category' | 'date' | 'amount';
type TransactionSort = { column: SortColumn; direction: 'asc' | 'desc' };
const transactionColumns: { key: SortColumn; label: string }[] = [
  { key: 'description', label: 'Descrição' }, { key: 'kind', label: 'Tipo' },
  { key: 'category', label: 'Categoria' }, { key: 'date', label: 'Data' }, { key: 'amount', label: 'Valor' },
];

function DevendoTypeField({ value, onChange, disabled = false, label = 'Tipo de Devendo' }: {
  value: Expense['devendo_type']; onChange: (value: Expense['devendo_type']) => void; disabled?: boolean; label?: string;
}) {
  return <TextField select fullWidth size="small" label={label} value={value} disabled={disabled}
    onChange={(event) => onChange(event.target.value as Expense['devendo_type'])}>
    <MenuItem value="personal">Gasto pessoal</MenuItem>
    <MenuItem value="salary">Salário</MenuItem>
  </TextField>;
}

export default function App() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [selectedYear, selectedMonth] = month.split('-').map(Number);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 3 + index);
  if (!years.includes(selectedYear)) years.push(selectedYear);
  years.sort((a, b) => a - b);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [devendoExpenses, setDevendoExpenses] = useState<Expense[]>([]);
  const [salaryMonth, setSalaryMonth] = useState(localDate().slice(0, 7));
  const salaryMonthOptions = [...new Set([
    salaryMonth,
    ...years.flatMap((year) => months.map((item) => `${year}-${String(item.value).padStart(2, '0')}`)),
    ...devendoExpenses.filter((expense) => expense.devendo_type === 'salary').map((expense) => expense.date.slice(0, 7)),
  ])].sort().reverse();
  const personalDevendo = devendoExpenses.filter((expense) => expense.devendo_type !== 'salary');
  const [showHiddenDevendo, setShowHiddenDevendo] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState<number | null>(null);
  const hiddenDevendoCount = personalDevendo.filter((expense) => expense.devendo_hidden).length;
  const visiblePersonalDevendo = personalDevendo.filter((expense) => showHiddenDevendo || !expense.devendo_hidden);
  const salaryExpenses = devendoExpenses.filter((expense) => expense.devendo_type === 'salary' && expense.date.slice(0, 7) === salaryMonth);
  const salaryIncome = salaryExpenses.filter((expense) => expense.kind === 'income')
    .reduce((total, expense) => total + amountInCents(expense.amount), 0n);
  const salaryOutflow = salaryExpenses.filter((expense) => expense.kind === 'expense')
    .reduce((total, expense) => total + amountInCents(expense.amount), 0n);
  const salaryBalance = salaryIncome - salaryOutflow;
  const otherExpenses = expenses.filter((expense) => !isDevendo(expense));
  const routineExpenseCount = otherExpenses.filter((expense) => expense.kind === 'expense').length;
  const devendoOutflow = personalDevendo.filter((expense) => expense.kind === 'expense')
    .reduce((total, expense) => total + amountInCents(expense.amount), 0n);
  const devendoIncome = personalDevendo.filter((expense) => expense.kind === 'income')
    .reduce((total, expense) => total + amountInCents(expense.amount), 0n);
  const devendoBalance = devendoOutflow - devendoIncome;
  const [descriptionFilter, setDescriptionFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const filteredExpenses = expenses.filter((expense) =>
    expense.description.toLocaleLowerCase('pt-BR').includes(descriptionFilter.trim().toLocaleLowerCase('pt-BR'))
    && (!kindFilter || expense.kind === kindFilter)
    && (!categoryFilter || expense.category === categoryFilter));
  const [netDescriptionFilter, setNetDescriptionFilter] = useState('');
  const [netKindFilter, setNetKindFilter] = useState('expense');
  const [netCategoryFilter, setNetCategoryFilter] = useState('');
  const filteredOtherExpenses = otherExpenses.filter((expense) =>
    expense.description.toLocaleLowerCase('pt-BR').includes(netDescriptionFilter.trim().toLocaleLowerCase('pt-BR'))
    && (!netKindFilter || expense.kind === netKindFilter)
    && (!netCategoryFilter || expense.category === netCategoryFilter));
  const [categories, setCategories] = useState<Category[]>([]);
  const categoryColor = (category: string) => {
    const index = Math.max(0, categories.findIndex((item) => item.name === category));
    const hue = (index * 137.508) % 360;
    return {
      background: `hsl(${hue} 65% 88%)`,
      foreground: `hsl(${hue} 65% 25%)`,
      chart: `hsl(${hue} 65% 45%)`,
    };
  };
  const categoryTotals = expenses.reduce((totals, expense) => {
    if (expense.kind === 'income' || isDevendo(expense)) return totals;
    totals.set(expense.category, (totals.get(expense.category) ?? 0n) + amountInCents(expense.amount));
    return totals;
  }, new Map<string, bigint>());
  const sortedCategoryTotals = [...categoryTotals.entries()].sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0);
  const totalByCategory = sortedCategoryTotals.reduce((total, [, amount]) => total + amount, 0n);
  let chartPosition = 0;
  const chartSlices = sortedCategoryTotals.map(([category, amount]) => {
    const start = chartPosition;
    chartPosition += Number(amount) / Number(totalByCategory) * 100;
    return { category, amount, start, end: chartPosition, color: categoryColor(category).chart };
  });
  const pieBackground = chartSlices.length
    ? `conic-gradient(${chartSlices.map((slice) => `${slice.color} ${slice.start}% ${slice.end}%`).join(', ')})`
    : 'transparent';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Expense | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editForm, setEditForm] = useState<NewExpense>(emptyForm);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [splittingExpense, setSplittingExpense] = useState<Expense | null>(null);
  const [splitPayment, setSplitPayment] = useState<{ description: string; amount: string; date: string } | null>(null);
  const [splitParts, setSplitParts] = useState<SplitPart[]>([]);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitError, setSplitError] = useState('');
  const splitSum = splitParts.reduce((total, part) => total + (inputAmountInCents(part.amount) ?? 0n), 0n);
  const splitDifference = splitPayment ? amountInCents(splitPayment.amount) - splitSum : 0n;
  const splitValid = splitParts.length >= 2 && splitDifference === 0n && splitParts.every((part) =>
    (inputAmountInCents(part.amount) ?? 0n) > 0n && part.description.trim() && part.category);
  const [activeTab, setActiveTab] = useState<'expenses' | 'devendo' | 'categories'>('expenses');
  const [transactionsTab, setTransactionsTab] = useState<'net' | 'all'>('net');
  const [transactionSorts, setTransactionSorts] = useState<Record<TransactionTable, TransactionSort>>({
    net: { column: 'date', direction: 'desc' },
    all: { column: 'date', direction: 'desc' },
    devendo: { column: 'date', direction: 'desc' },
    salary: { column: 'date', direction: 'desc' },
  });
  const [pages, setPages] = useState<Record<PaginatedTable, number>>({ net: 0, all: 0, devendo: 0, salary: 0, categories: 0, import: 0, chart: 0 });
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editedCategoryName, setEditedCategoryName] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<(ImportCandidate & { include: boolean })[]>([]);
  const [ignoredImportRows, setIgnoredImportRows] = useState(0);
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    setPages((current) => ({ ...current, net: 0 }));
  }, [month, netDescriptionFilter, netKindFilter, netCategoryFilter, transactionSorts.net]);

  useEffect(() => {
    setPages((current) => ({ ...current, all: 0 }));
  }, [month, descriptionFilter, kindFilter, categoryFilter, transactionSorts.all]);

  useEffect(() => {
    setPages((current) => ({ ...current, devendo: 0 }));
  }, [transactionSorts.devendo, showHiddenDevendo]);

  useEffect(() => {
    setPages((current) => ({ ...current, salary: 0 }));
  }, [salaryMonth, transactionSorts.salary]);

  useEffect(() => {
    setPages((current) => ({ ...current, chart: 0 }));
  }, [month]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSummary(null);
    setExpenses([]);
    setDevendoExpenses([]);
    setError('');
    Promise.all([
      request<Expense[]>(`/expenses?month=${month}`, { signal: controller.signal }),
      request<Summary>(`/expenses/summary?month=${month}`, { signal: controller.signal }),
      request<Category[]>('/categories', { signal: controller.signal }),
      request<Expense[]>('/expenses/devendo', { signal: controller.signal }),
    ]).then(([items, totals, availableCategories, devendoItems]) => {
      setExpenses(items);
      setSummary(totals);
      setCategories(availableCategories);
      setDevendoExpenses(devendoItems);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [month, reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await request<Expense>('/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: form.amount.replace(',', '.') }),
      });
      setMonth(form.date.slice(0, 7));
      setForm(emptyForm());
      setSuccess('Gasto registrado.');
      setReload((value) => value + 1);
    } catch (err) { setError(errorMessage(err)); }
    finally { setSaving(false); }
  }

  async function readImportFile(file?: File) {
    if (!file) return;
    setImportBusy(true);
    setImportError('');
    setImportRows([]);
    setPages((current) => ({ ...current, import: 0 }));
    try {
      const preview = await previewImport(await file.arrayBuffer());
      setImportRows(preview.candidates.map((item) => ({
        ...item,
        category: '',
        include: !item.card_payment && !item.duplicate,
      })));
      setIgnoredImportRows(preview.ignored_rows);
    } catch (err) { setImportError(errorMessage(err)); }
    finally { setImportBusy(false); }
  }

  async function confirmImport() {
    const selectedRows = importRows.filter((row) => row.include);
    if (!selectedRows.length) return;
    setImportBusy(true);
    setImportError('');
    try {
      const result = await request<{ imported: number; duplicates: number }>('/expenses/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenses: selectedRows.map(({ include, card_payment, duplicate, ...item }) => item) }),
      });
      setImportRows([]);
      setSuccess(`Importados ${result.imported} lançamento(s); ${result.duplicates} duplicata(s) ignorada(s).`);
      setReload((value) => value + 1);
    } catch (err) { setImportError(errorMessage(err)); }
    finally { setImportBusy(false); }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingCategory(true);
    setCategoryError('');
    setSuccess('');
    try {
      const category = await request<Category>('/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName }),
      });
      setCategories((current) => [...current, category].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setForm((current) => ({ ...current, category: category.name }));
      setNewCategoryName('');
      setSuccess(`Categoria “${category.name}” criada.`);
    } catch (err) { setCategoryError(errorMessage(err)); }
    finally { setCreatingCategory(false); }
  }

  async function renameCategory(currentName: string) {
    setCategoryBusy(true);
    setCategoryError('');
    setSuccess('');
    try {
      const updated = await request<Category>(`/categories?current_name=${encodeURIComponent(currentName)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editedCategoryName }),
      });
      setCategories((current) => current.map((category) => category.name === currentName ? updated : category)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setForm((current) => current.category === currentName ? { ...current, category: updated.name } : current);
      if (updated.expense_count > 0) setReload((value) => value + 1);
      setEditingCategory(null);
      setSuccess(`Categoria renomeada para “${updated.name}”.`);
    } catch (err) { setCategoryError(errorMessage(err)); }
    finally { setCategoryBusy(false); }
  }

  async function deleteCategory() {
    if (!categoryToDelete) return;
    setCategoryBusy(true);
    setCategoryError('');
    setSuccess('');
    try {
      await request<void>(`/categories?name=${encodeURIComponent(categoryToDelete)}`, { method: 'DELETE' });
      setCategories((current) => current.filter((category) => category.name !== categoryToDelete));
      setForm((current) => current.category === categoryToDelete ? { ...current, category: '' } : current);
      setCategoryToDelete(null);
      setSuccess(`Categoria “${categoryToDelete}” excluída.`);
    } catch (err) { setCategoryError(errorMessage(err)); }
    finally { setCategoryBusy(false); }
  }

  async function remove() {
    if (!selected) return;
    setDeleting(true);
    setError('');
    setSuccess('');
    try {
      await request<void>(`/expenses/${selected.id}`, { method: 'DELETE' });
      setSelected(null);
      setSuccess('Lançamento excluído.');
      setReload((value) => value + 1);
    } catch (err) { setError(errorMessage(err)); }
    finally { setDeleting(false); }
  }

  function openEdit(expense: Expense) {
    setEditingExpense(expense);
    setEditForm({ description: expense.description, amount: expense.amount.replace('.', ','), date: expense.date, category: expense.category, devendo_type: expense.devendo_type });
    setEditError('');
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingExpense) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await request<Expense>(`/expenses/${editingExpense.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, amount: editForm.amount.replace(',', '.') }),
      });
      setEditingExpense(null);
      setSuccess('Lançamento atualizado.');
      setReload((value) => value + 1);
    } catch (err) { setEditError(errorMessage(err)); }
    finally { setSavingEdit(false); }
  }

  async function openSplit(expense: Expense) {
    setSplittingExpense(expense);
    setSplitError('');
    setSplitPayment({ description: expense.split_description ?? expense.description, amount: expense.split_total ?? expense.amount, date: expense.date });
    setSplitParts([]);
    if (!expense.split_id) {
      setSplitParts([
        { description: expense.description, amount: expense.amount.replace('.', ','), category: expense.category, devendo_type: expense.devendo_type },
        { description: '', amount: '', category: '', devendo_type: 'personal' },
      ]);
      return;
    }
    setSplitBusy(true);
    try {
      const result = await request<ExpenseSplit>(`/expenses/${expense.id}/split`);
      setSplitPayment(result.payment);
      setSplitParts(result.parts.map((part) => ({ description: part.description, amount: part.amount.replace('.', ','), category: part.category, devendo_type: part.devendo_type })));
    } catch (err) { setSplitError(errorMessage(err)); }
    finally { setSplitBusy(false); }
  }

  async function saveSplit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!splittingExpense || !splitValid) return;
    setSplitBusy(true);
    setSplitError('');
    try {
      await request<ExpenseSplit>(`/expenses/${splittingExpense.id}/split`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: splitParts.map((part) => ({ ...part, amount: part.amount.replace(',', '.') })) }),
      });
      setSplittingExpense(null);
      setSuccess('Divisão salva. O valor total do pagamento foi preservado.');
      setReload((value) => value + 1);
    } catch (err) { setSplitError(errorMessage(err)); }
    finally { setSplitBusy(false); }
  }

  async function toggleDevendoVisibility(expense: Expense) {
    setVisibilityBusy(expense.id);
    setError('');
    try {
      const result = await request<Expense>(`/expenses/${expense.id}/devendo-visibility`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: !expense.devendo_hidden }),
      });
      const updateVisibility = (item: Expense) => item.id === expense.id ? { ...item, devendo_hidden: result.devendo_hidden } : item;
      setDevendoExpenses((current) => current.map(updateVisibility));
      setExpenses((current) => current.map(updateVisibility));
      setSuccess(result.devendo_hidden ? 'Lançamento ocultado da tabela de Devendo. Os totais foram mantidos.' : 'Lançamento restaurado na tabela de Devendo.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setVisibilityBusy(null); }
  }

  function currentPage(table: PaginatedTable, count: number) {
    return Math.min(pages[table], Math.max(0, Math.ceil(count / rowsPerPage) - 1));
  }

  function pageItems<T>(items: T[], table: PaginatedTable) {
    const start = currentPage(table, items.length) * rowsPerPage;
    return items.slice(start, start + rowsPerPage);
  }

  function renderPagination(table: PaginatedTable, count: number, label: string) {
    return <TablePagination component="div" aria-label={`Paginação de ${label}`} count={count}
      rowsPerPage={rowsPerPage} rowsPerPageOptions={[rowsPerPage]} page={currentPage(table, count)}
      onPageChange={(_, page) => setPages((current) => ({ ...current, [table]: page }))}
      labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
      getItemAriaLabel={(type) => ({ first: 'Primeira página', last: 'Última página', next: 'Próxima página', previous: 'Página anterior' })[type]} />;
  }

  function renderTransactions(items: Expense[], label: string, table: TransactionTable) {
    if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress aria-label={`Carregando ${label}`} /></Box>;
    if (!summary) return <Typography sx={{ p: 3 }} color="text.secondary">Não foi possível carregar os lançamentos.</Typography>;
    if (!items.length) return <Typography sx={{ p: 3 }} color="text.secondary">Nenhum lançamento para exibir.</Typography>;
    const sort = transactionSorts[table];
    const sortedItems = [...items].sort((a, b) => {
      let comparison: number;
      if (sort.column === 'amount') {
        const first = amountInCents(a.amount);
        const second = amountInCents(b.amount);
        comparison = first < second ? -1 : first > second ? 1 : 0;
      } else {
        const first = sort.column === 'kind' ? (a.kind === 'income' ? 'Entrada' : 'Saída') : a[sort.column];
        const second = sort.column === 'kind' ? (b.kind === 'income' ? 'Entrada' : 'Saída') : b[sort.column];
        comparison = first.localeCompare(second, 'pt-BR', { sensitivity: 'base', numeric: true });
      }
      return (sort.direction === 'asc' ? comparison : -comparison) || b.id - a.id;
    });
    return <><TableContainer><Table aria-label={label}>
      <TableHead><TableRow>
        {transactionColumns.map((column) => <TableCell key={column.key}
          align={column.key === 'amount' ? 'right' : 'left'} sortDirection={sort.column === column.key ? sort.direction : false}>
          <TableSortLabel active={sort.column === column.key} direction={sort.column === column.key ? sort.direction : 'asc'}
            aria-label={`Ordenar por ${column.label}`} onClick={() => setTransactionSorts((current) => ({
              ...current,
              [table]: { column: column.key, direction: current[table].column === column.key && current[table].direction === 'asc' ? 'desc' : 'asc' },
            }))}>{column.label}</TableSortLabel>
        </TableCell>)}
        <TableCell align="right">Ações</TableCell>
      </TableRow></TableHead>
      <TableBody>{pageItems(sortedItems, table).map((expense) => <TableRow key={expense.id}
        sx={table === 'devendo' && expense.devendo_hidden ? { opacity: 0.65 } : undefined}>
        <TableCell sx={{ overflowWrap: 'anywhere', maxWidth: 300 }}>
          {expense.description}
          {table === 'devendo' && expense.devendo_hidden && <Typography variant="caption" display="block">Oculto nesta tabela</Typography>}
          {expense.split_id && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Pagamento #{expense.split_id}: {expense.split_description} · total {currency(expense.split_total ?? expense.amount)}
          </Typography>}
        </TableCell>
        <TableCell><Chip size="small" color={expense.kind === 'income' ? 'success' : 'default'} label={expense.kind === 'income' ? 'Entrada' : 'Saída'} /></TableCell>
        <TableCell><Chip size="small" label={expense.category} sx={{
          bgcolor: categoryColor(expense.category).background,
          color: categoryColor(expense.category).foreground, fontWeight: 600,
        }} />{isDevendo(expense) && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {expense.devendo_type === 'salary' ? 'Salário' : 'Gasto pessoal'}
        </Typography>}</TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>{expense.date.split('-').reverse().join('/')}</TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(expense.amount)}</TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          {table === 'devendo' && <Button disabled={visibilityBusy !== null}
            aria-label={`${expense.devendo_hidden ? 'Restaurar' : 'Ocultar'} ${expense.description}`}
            onClick={() => void toggleDevendoVisibility(expense)}>
            {visibilityBusy === expense.id ? 'Salvando…' : expense.devendo_hidden ? 'Restaurar' : 'Ocultar'}
          </Button>}
          <Button aria-label={`Editar ${expense.description}`} onClick={() => openEdit(expense)}>Editar</Button>
          {expense.kind === 'expense' && <Button aria-label={expense.split_id ? `Editar divisão de ${expense.description}` : `Dividir ${expense.description}`}
            onClick={() => void openSplit(expense)}>{expense.split_id ? 'Editar divisão' : 'Dividir'}</Button>}
          <Button color="error" aria-label={`Excluir ${expense.description}`} onClick={() => setSelected(expense)}>Excluir</Button>
        </TableCell>
      </TableRow>)}</TableBody>
    </Table></TableContainer>{renderPagination(table, items.length, label)}</>;
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 6 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">FINANÇAS PESSOAIS</Typography>
          <Typography variant="h4" component="h1" fontWeight={700}>Meu controle de gastos</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>Entenda para onde seu dinheiro vai, um registro por vez.</Typography>
        </Box>
        {error && <Alert severity="error" action={<Button color="inherit" onClick={() => setReload((v) => v + 1)}>Recarregar</Button>}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
        <Tabs value={activeTab} onChange={(_, value: 'expenses' | 'devendo' | 'categories') => setActiveTab(value)} aria-label="Seções de finanças">
          <Tab value="expenses" label="Lançamentos" />
          <Tab value="devendo" label="Devendo" />
          <Tab value="categories" label="Categorias" />
        </Tabs>
        {activeTab === 'expenses' ? <Stack spacing={3}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Paper variant="outlined" sx={{ p: 3, flex: 1 }}>
            <Typography color="text.secondary">Gastos da rotina no mês</Typography>
            <Typography variant="h4" component="p" fontWeight={700} color="primary" sx={{ mt: 1 }}>
              {summary ? currency(summary.routine_total) : '—'}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {summary ? `${routineExpenseCount} gasto(s), sem Devendo` : 'Aguardando dados'}
            </Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 3, minWidth: 240 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Mês de referência</Typography>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Button aria-label="Mês anterior" disabled={month <= '0001-01'}
                onClick={() => setMonth((value) => shiftMonth(value, -1))}>‹</Button>
              <Stack direction="row" spacing={1}>
                <FormControl size="small" sx={{ minWidth: 58 }}>
                  <Select variant="standard" aria-label="Mês" value={selectedMonth}
                    sx={{ '&:before, &:after': { display: 'none' }, '& .MuiSelect-select': { py: 0.5, typography: 'h6' } }}
                    onChange={(event) =>
                    setMonth(`${String(selectedYear).padStart(4, '0')}-${String(event.target.value).padStart(2, '0')}`)}>
                    {months.map((item) => {
                      const label = item.label.charAt(0).toLocaleUpperCase('pt-BR') + item.label.slice(1);
                      return <MenuItem key={item.value} value={item.value}>{label}</MenuItem>;
                    })}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 64 }}>
                  <Select variant="standard" aria-label="Ano" value={selectedYear}
                    sx={{ '&:before, &:after': { display: 'none' }, '& .MuiSelect-select': { py: 0.5, typography: 'h6' } }}
                    onChange={(event) =>
                    setMonth(`${String(event.target.value).padStart(4, '0')}-${String(selectedMonth).padStart(2, '0')}`)}>
                    {years.map((year) => <MenuItem key={year} value={year}>{year}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
              <Button aria-label="Próximo mês" disabled={month >= '9998-12'}
                onClick={() => setMonth((value) => shiftMonth(value, 1))}>›</Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>O resumo e os lançamentos correspondem ao mês selecionado.</Typography>
          </Paper>
        </Stack>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>Registrar gasto</Typography>
          <Box component="form" onSubmit={save}>
            <Stack spacing={2}>
              <TextField label="Descrição" placeholder="Ex.: compras do mercado" required value={form.description}
                slotProps={{ htmlInput: { maxLength: 200 } }} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Valor (R$)" required value={form.amount} fullWidth
                  placeholder="0,00" slotProps={{ htmlInput: { inputMode: 'decimal', pattern: '[0-9]+([.,][0-9]{1,2})?' } }}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <TextField label="Data" type="date" required value={form.date} fullWidth
                  slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                <Stack spacing={0.5} sx={{ width: '100%' }}>
                  <TextField label="Categoria" select required value={form.category} fullWidth
                    disabled={categories.length === 0}
                    helperText={categories.length === 0 ? 'Crie uma categoria para começar.' : undefined}
                    onChange={(e) => setForm({ ...form, category: e.target.value,
                      devendo_type: isDevendo({ category: e.target.value }) ? form.devendo_type : 'personal' })}>
                    {categories.map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
                  </TextField>
                </Stack>
              </Stack>
              {isDevendo(form) && <DevendoTypeField value={form.devendo_type} disabled={saving}
                onChange={(value) => setForm({ ...form, devendo_type: value })} />}
              <Button type="submit" variant="contained" disabled={saving || categories.length === 0} sx={{ alignSelf: 'flex-start' }}>
                {saving ? 'Salvando…' : 'Adicionar gasto'}
              </Button>
            </Stack>
          </Box>
        </Paper>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" component="h2">Importar extrato do Banco do Brasil</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Selecione o CSV para revisar entradas e saídas e escolher as categorias.
                Use Devendo tanto nos gastos pessoais quanto nas devoluções para esta conta.
                {' '}Nos recebimentos e repasses do seu salário, selecione o tipo Salário.
              </Typography>
            </Box>
            <Button component="label" variant="outlined" disabled={importBusy} sx={{ alignSelf: 'flex-start' }}>
              {importBusy ? 'Lendo arquivo…' : 'Selecionar arquivo CSV'}
              <input hidden type="file" accept=".csv,text/csv" onChange={(event) => {
                void readImportFile(event.target.files?.[0]);
                event.target.value = '';
              }} />
            </Button>
            {importError && <Alert severity="error">{importError}</Alert>}
            {importRows.length > 0 && <>
              <Alert severity="info">
                {importRows.filter((row) => row.kind === 'income').length} entrada(s) e {importRows.filter((row) => row.kind === 'expense').length} saída(s) encontrada(s); {ignoredImportRows} linha(s) de saldo, valor zero ou inválida(s) ignorada(s).
                Duplicatas e pagamentos de cartão ficam desmarcados; confira antes de confirmar.
              </Alert>
              <TableContainer>
                <Table size="small" aria-label="Prévia da importação do extrato">
                  <TableHead><TableRow>
                    <TableCell>Importar</TableCell><TableCell>Data</TableCell><TableCell>Tipo</TableCell><TableCell>Descrição para salvar</TableCell>
                    <TableCell align="right">Valor</TableCell><TableCell>Categoria</TableCell>
                  </TableRow></TableHead>
                  <TableBody>{pageItems(importRows, 'import').map((row) => <TableRow key={row.row_number}>
                    <TableCell padding="checkbox">
                      <Checkbox checked={row.include} disabled={row.duplicate}
                        onChange={(event) => setImportRows((current) => current.map((item) =>
                        item.row_number === row.row_number ? { ...item, include: event.target.checked } : item))}
                        inputProps={{ 'aria-label': `Importar ${row.description}` }} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.date.split('-').reverse().join('/')}</TableCell>
                    <TableCell><Chip size="small" color={row.kind === 'income' ? 'success' : 'default'} label={row.kind === 'income' ? 'Entrada' : 'Saída'} /></TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <TextField size="small" fullWidth required value={row.description}
                        inputProps={{ maxLength: 200, 'aria-label': `Descrição do lançamento importado: ${row.source_description}` }}
                        title={`Descrição original do extrato: ${row.source_description}`}
                        onChange={(event) => setImportRows((current) => current.map((item) =>
                          item.row_number === row.row_number ? { ...item, description: event.target.value } : item))} />
                      {row.duplicate && <Chip size="small" color="default" label="Já importado" sx={{ mt: 0.5, mr: 0.5 }} />}
                      {row.card_payment && <Chip size="small" color="warning" label="Pagamento de cartão" sx={{ mt: 0.5 }} />}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(row.amount)}</TableCell>
                    <TableCell>
                      <TextField select size="small" value={row.category} disabled={categories.length === 0}
                        aria-label={`Categoria de ${row.description}`}
                        onChange={(event) => setImportRows((current) => current.map((item) =>
                          item.row_number === row.row_number ? { ...item, category: event.target.value,
                            devendo_type: isDevendo({ category: event.target.value }) ? item.devendo_type : 'personal' } : item))}>
                        <MenuItem value="">Selecione…</MenuItem>
                        {categories.map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
                      </TextField>
                      {isDevendo(row) && <Box sx={{ mt: 1, minWidth: 160 }}>
                        <DevendoTypeField label={`Tipo de Devendo de ${row.description}`} value={row.devendo_type} disabled={row.duplicate || importBusy}
                          onChange={(value) => setImportRows((current) => current.map((item) =>
                            item.row_number === row.row_number ? { ...item, devendo_type: value } : item))} />
                      </Box>}
                    </TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </TableContainer>
              {renderPagination('import', importRows.length, 'prévia da importação')}
              {categories.length === 0 && <Alert severity="warning">Crie categorias antes de importar para classificar os lançamentos.</Alert>}
              <Button variant="contained" disabled={importBusy || !importRows.some((row) => row.include)
                || importRows.some((row) => row.include && (!row.category || !row.description.trim()))
                || categories.length === 0}
                onClick={() => void confirmImport()} sx={{ alignSelf: 'flex-start' }}>
                {importBusy ? 'Importando…' : `Importar ${importRows.filter((row) => row.include).length} lançamento(s)`}
              </Button>
            </>}
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Tabs value={transactionsTab} onChange={(_, value: 'net' | 'all') => setTransactionsTab(value)}
            aria-label="Visualização dos lançamentos" variant="scrollable" scrollButtons="auto" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="net" label="Lançamentos líquidos" id="transactions-tab-net" aria-controls="transactions-panel-net" />
            <Tab value="all" label="Todos os Lançamentos" id="transactions-tab-all" aria-controls="transactions-panel-all" />
          </Tabs>
          {transactionsTab === 'net' ? <Box role="tabpanel" id="transactions-panel-net" aria-labelledby="transactions-tab-net">
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" component="h2">Lançamentos líquidos — mês selecionado</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Entradas e saídas do mês sem a categoria Devendo.</Typography>
          </Box>
          <Stack spacing={1.5} sx={{ px: 3, pb: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Buscar descrição" size="small" value={netDescriptionFilter}
                onChange={(event) => setNetDescriptionFilter(event.target.value)} sx={{ flex: 2 }} />
              <TextField label="Tipo" select size="small" value={netKindFilter}
                onChange={(event) => setNetKindFilter(event.target.value)} sx={{ flex: 1, minWidth: 140 }}>
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="income">Entradas</MenuItem>
                <MenuItem value="expense">Saídas</MenuItem>
              </TextField>
              <TextField label="Categoria" select size="small" value={netCategoryFilter}
                onChange={(event) => setNetCategoryFilter(event.target.value)} sx={{ flex: 1, minWidth: 160 }}>
                <MenuItem value="">Todas</MenuItem>
                {categories.filter((category) => category.name.trim().toLocaleLowerCase('pt-BR') !== 'devendo')
                  .map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
              </TextField>
              <Button disabled={!netDescriptionFilter && !netKindFilter && !netCategoryFilter} onClick={() => {
                setNetDescriptionFilter(''); setNetKindFilter(''); setNetCategoryFilter('');
              }}>Limpar filtros</Button>
            </Stack>
            {!loading && summary && <Typography variant="body2" color="text.secondary" role="status">
              {filteredOtherExpenses.length} de {otherExpenses.length} lançamento(s)
            </Typography>}
          </Stack>
          {!loading && summary && otherExpenses.length > 0 && filteredOtherExpenses.length === 0
            ? <Typography sx={{ p: 3 }} color="text.secondary">Nenhum lançamento corresponde aos filtros selecionados.</Typography>
            : renderTransactions(filteredOtherExpenses, 'Lançamentos líquidos — mês selecionado', 'net')}
          </Box> : <Box role="tabpanel" id="transactions-panel-all" aria-labelledby="transactions-tab-all">
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" component="h2">Todos os lançamentos — mês selecionado</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Lista completa do mês, incluindo Devendo, para conferência. Os filtros abaixo afetam somente esta tabela.
            </Typography>
          </Box>
          <Stack spacing={1.5} sx={{ px: 3, pb: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Buscar descrição" size="small" value={descriptionFilter}
                onChange={(event) => setDescriptionFilter(event.target.value)} sx={{ flex: 2 }} />
              <TextField label="Tipo" select size="small" value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)} sx={{ flex: 1, minWidth: 140 }}>
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="income">Entradas</MenuItem>
                <MenuItem value="expense">Saídas</MenuItem>
              </TextField>
              <TextField label="Categoria" select size="small" value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)} sx={{ flex: 1, minWidth: 160 }}>
                <MenuItem value="">Todas</MenuItem>
                {categories.map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
              </TextField>
              <Button disabled={!descriptionFilter && !kindFilter && !categoryFilter} onClick={() => {
                setDescriptionFilter(''); setKindFilter(''); setCategoryFilter('');
              }}>Limpar filtros</Button>
            </Stack>
            {!loading && summary && <Typography variant="body2" color="text.secondary" role="status">
              {filteredExpenses.length} de {expenses.length} lançamento(s)
            </Typography>}
          </Stack>
          {!loading && summary && expenses.length > 0 && filteredExpenses.length === 0
            ? <Typography sx={{ p: 3 }} color="text.secondary">Nenhum lançamento corresponde aos filtros selecionados.</Typography>
            : renderTransactions(filteredExpenses, 'Todos os lançamentos — mês selecionado', 'all')}
          </Box>}
        </Paper>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>Gastos da rotina por categoria</Typography>
          {loading ? <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress aria-label="Carregando gráfico" /></Box>
            : chartSlices.length === 0 ? <Typography color="text.secondary">Sem gastos para exibir neste mês.</Typography>
            : <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} alignItems="center">
              <Box role="img" aria-label={`Gráfico de pizza dos gastos por categoria em ${months[selectedMonth - 1].label} de ${selectedYear}`}
                sx={{ width: 220, height: 220, flexShrink: 0, borderRadius: '50%', background: pieBackground }} />
              <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, width: '100%', maxWidth: 720 }}>
                <Table size="small" aria-label="Proporção de gastos por categoria">
                  <TableHead>
                    <TableRow sx={{ '& th': { fontWeight: 600, color: 'text.secondary', bgcolor: 'background.default' } }}>
                      <TableCell>Categoria</TableCell>
                      <TableCell align="right">Proporção</TableCell>
                      <TableCell align="right">Valor</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pageItems(chartSlices, 'chart').map((slice) => <TableRow key={slice.category} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box aria-hidden="true" sx={{ width: 12, height: 12, flexShrink: 0, borderRadius: '2px', bgcolor: slice.color }} />
                          <Typography>{slice.category}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        {(Number(slice.amount) / Number(totalByCategory) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {currency((Number(slice.amount) / 100).toFixed(2))}
                      </TableCell>
                    </TableRow>)}
                    <TableRow sx={{ '& th, & td': { fontWeight: 700, bgcolor: 'background.default' } }}>
                      <TableCell component="th" scope="row">Total</TableCell>
                      <TableCell align="right">100%</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {currency((Number(totalByCategory) / 100).toFixed(2))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {renderPagination('chart', chartSlices.length, 'gastos por categoria')}
              </TableContainer>
              <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' }, width: '100%' }}>
                {pageItems(chartSlices, 'chart').map((slice) => <Stack key={slice.category} spacing={0.5}
                  sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box aria-hidden="true" sx={{ width: 12, height: 12, flexShrink: 0, borderRadius: '2px', bgcolor: slice.color }} />
                    <Typography fontWeight={600}>{slice.category}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" sx={{ pl: 2.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      Proporção: {(Number(slice.amount) / Number(totalByCategory) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      Valor: {currency((Number(slice.amount) / 100).toFixed(2))}
                    </Typography>
                  </Stack>
                </Stack>)}
                <Stack spacing={0.5} sx={{ pt: 1 }}>
                  <Typography fontWeight={700}>Total</Typography>
                  <Stack direction="row" justifyContent="space-between" sx={{ pl: 2.5 }}>
                    <Typography variant="body2" fontWeight={700}>Proporção: 100%</Typography>
                    <Typography variant="body2" fontWeight={700}>
                      Valor: {currency((Number(totalByCategory) / 100).toFixed(2))}
                    </Typography>
                  </Stack>
                </Stack>
                {renderPagination('chart', chartSlices.length, 'gastos por categoria')}
              </Stack>
            </Stack>}
        </Paper>
        </Stack> : activeTab === 'devendo' ? <Stack spacing={3}>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" component="h2">Gastos pessoais a devolver — todos os meses</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Gastos pessoais pagos pelo BB e suas devoluções. Recebimentos e repasses de salário ficam separados abaixo.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mt: 2 }}>
              <Box><Typography color="text.secondary">Saídas</Typography>
                <Typography fontWeight={700}>{summary ? currency((Number(devendoOutflow) / 100).toFixed(2)) : '—'}</Typography></Box>
              <Box><Typography color="text.secondary">Devoluções</Typography>
                <Typography fontWeight={700}>{summary ? currency((Number(devendoIncome) / 100).toFixed(2)) : '—'}</Typography></Box>
              <Box><Typography color="text.secondary">{devendoBalance < 0n ? 'Crédito em Devendo' : 'A devolver'}</Typography>
                <Typography fontWeight={700} color={devendoBalance > 0n ? 'warning.main' : 'success.main'}>
                  {summary ? currency((Number(devendoBalance < 0n ? -devendoBalance : devendoBalance) / 100).toFixed(2)) : '—'}
                </Typography></Box>
            </Stack>
            {!loading && summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {visiblePersonalDevendo.length} de {personalDevendo.length} lançamento(s) de todos os meses · {hiddenDevendoCount} oculto(s)
            </Typography>}
            <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={showHiddenDevendo}
              onChange={(event) => setShowHiddenDevendo(event.target.checked)} />} label="Mostrar ocultos" />
            <Typography variant="body2" color="text.secondary">
              Ocultar organiza apenas esta tabela. Os totais e a lista Todos os Lançamentos continuam incluindo esses registros.
            </Typography>
          </Box>
          {renderTransactions(visiblePersonalDevendo, 'Gastos pessoais a devolver — todos os meses', 'devendo')}
        </Paper>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}>
              <Typography variant="h6" component="h2">Salário a repassar</Typography>
              <TextField label="Mês do salário" select size="small" value={salaryMonth} sx={{ minWidth: 210 }}
                onChange={(event) => setSalaryMonth(event.target.value)}>
                {salaryMonthOptions.map((value) => {
                  const [year, monthNumber] = value.split('-').map(Number);
                  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(year, monthNumber - 1, 1));
                  return <MenuItem key={value} value={value}>{label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1)}/{year}</MenuItem>;
                })}
              </TextField>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Recebimentos e transferências para sua conta pessoal no mês escolhido, incluindo bolsa ou outros rendimentos próprios.
              Esses valores não entram nas saídas e devoluções dos gastos pessoais.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mt: 2 }}>
              <Box><Typography color="text.secondary">Recebido</Typography>
                <Typography fontWeight={700}>{summary ? currency((Number(salaryIncome) / 100).toFixed(2)) : '—'}</Typography></Box>
              <Box><Typography color="text.secondary">Repassado para sua conta</Typography>
                <Typography fontWeight={700}>{summary ? currency((Number(salaryOutflow) / 100).toFixed(2)) : '—'}</Typography></Box>
              <Box><Typography color="text.secondary">{salaryBalance < 0n ? 'Repassado a mais' : 'A repassar'}</Typography>
                <Typography fontWeight={700} color={salaryBalance > 0n ? 'warning.main' : 'success.main'}>
                  {summary ? currency((Number(salaryBalance < 0n ? -salaryBalance : salaryBalance) / 100).toFixed(2)) : '—'}
                </Typography></Box>
            </Stack>
            {!loading && summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{salaryExpenses.length} lançamento(s) neste mês</Typography>}
          </Box>
          {renderTransactions(salaryExpenses, 'Salário a repassar — mês selecionado', 'salary')}
        </Paper>
        </Stack> : <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" component="h2">Gerenciar categorias</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Crie e renomeie categorias. Lançamentos existentes acompanham o novo nome.
              </Typography>
            </Box>
            <Box component="form" onSubmit={createCategory}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField label="Nome da nova categoria" required fullWidth value={newCategoryName}
                  slotProps={{ htmlInput: { maxLength: 60 } }}
                  onChange={(event) => setNewCategoryName(event.target.value)} />
                <Button type="submit" variant="contained" disabled={creatingCategory}>
                  {creatingCategory ? 'Criando…' : 'Criar categoria'}
                </Button>
              </Stack>
            </Box>
            {categoryError && <Alert severity="error">{categoryError}</Alert>}
            {loading ? <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress aria-label="Carregando categorias" /></Box>
              : categories.length === 0 ? <Typography color="text.secondary">Nenhuma categoria criada ainda.</Typography>
              : <><TableContainer>
                <Table aria-label="Categorias cadastradas">
                  <TableHead><TableRow>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="right">Lançamentos associados</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow></TableHead>
                  <TableBody>{pageItems(categories, 'categories').map((category) => <TableRow key={category.name}>
                    <TableCell>
                      {editingCategory === category.name
                        ? <TextField size="small" autoFocus required fullWidth value={editedCategoryName}
                          slotProps={{ htmlInput: { maxLength: 60 } }}
                          onChange={(event) => setEditedCategoryName(event.target.value)} />
                        : category.name}
                    </TableCell>
                    <TableCell align="right">{category.expense_count}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {editingCategory === category.name
                        ? <>
                          <Button size="small" disabled={categoryBusy} onClick={() => renameCategory(category.name)}>Salvar</Button>
                          <Button size="small" disabled={categoryBusy} onClick={() => setEditingCategory(null)}>Cancelar</Button>
                        </>
                        : <>
                          <Button size="small" disabled={categoryBusy} onClick={() => {
                            setCategoryError(''); setEditingCategory(category.name); setEditedCategoryName(category.name);
                          }}>Renomear</Button>
                          <Button size="small" color="error" disabled={categoryBusy || category.expense_count > 0}
                            title={category.expense_count > 0 ? 'Esta categoria possui lançamentos associados.' : undefined}
                            onClick={() => { setCategoryError(''); setCategoryToDelete(category.name); }}>
                            Excluir
                          </Button>
                        </>}
                    </TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </TableContainer>{renderPagination('categories', categories.length, 'categorias cadastradas')}</>}
            <Typography variant="body2" color="text.secondary">
              Só é possível excluir categorias sem lançamentos associados.
            </Typography>
          </Stack>
        </Paper>}
      </Stack>
      <Dialog open={splittingExpense !== null} fullWidth maxWidth="md" onClose={() => { if (!splitBusy) setSplittingExpense(null); }}>
        <Box component="form" onSubmit={saveSplit} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <DialogTitle>{splittingExpense?.split_id ? 'Editar divisão do pagamento' : 'Dividir lançamento'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {splitPayment && <Box>
                <Typography fontWeight={600}>{splitPayment.description}</Typography>
                <Typography color="text.secondary">
                  Pagamento de {currency(splitPayment.amount)} em {splitPayment.date.split('-').reverse().join('/')}.
                  Distribua o valor entre as partes. Use Devendo na parte que você vai devolver à conta.
                </Typography>
              </Box>}
              {splitBusy && splitParts.length === 0 && <CircularProgress aria-label="Carregando divisão" />}
              {splitParts.map((part, index) => <Paper key={index} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={2}>
                  <Typography fontWeight={600}>Parte {index + 1}</Typography>
                  <TextField label={`Descrição da parte ${index + 1}`} required fullWidth value={part.description} disabled={splitBusy}
                    slotProps={{ htmlInput: { maxLength: 200 } }} onChange={(event) => setSplitParts((current) => current.map((item, i) =>
                      i === index ? { ...item, description: event.target.value } : item))} />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label={`Valor da parte ${index + 1} (R$)`} required fullWidth value={part.amount} disabled={splitBusy}
                      slotProps={{ htmlInput: { inputMode: 'decimal', pattern: '[0-9]+([.,][0-9]{1,2})?' } }}
                      onChange={(event) => setSplitParts((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} />
                    <TextField label={`Categoria da parte ${index + 1}`} select required fullWidth value={part.category} disabled={splitBusy}
                      onChange={(event) => setSplitParts((current) => current.map((item, i) => i === index ? { ...item, category: event.target.value,
                        devendo_type: isDevendo({ category: event.target.value }) ? item.devendo_type : 'personal' } : item))}>
                      {categories.map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
                    </TextField>
                  </Stack>
                  {isDevendo(part) && <DevendoTypeField label={`Tipo de Devendo da parte ${index + 1}`} value={part.devendo_type} disabled={splitBusy}
                    onChange={(value) => setSplitParts((current) => current.map((item, i) => i === index ? { ...item, devendo_type: value } : item))} />}
                  {splitParts.length > 2 && <Button disabled={splitBusy} color="error" sx={{ alignSelf: 'flex-start' }}
                    aria-label={`Remover parte ${index + 1}`} onClick={() => setSplitParts((current) => current.filter((_, i) => i !== index))}>Remover parte</Button>}
                </Stack>
              </Paper>)}
              <Button disabled={splitBusy || splitParts.length >= 10 || splitParts.length === 0} sx={{ alignSelf: 'flex-start' }}
                onClick={() => setSplitParts((current) => [...current, { description: '', amount: '', category: '', devendo_type: 'personal' }])}>Adicionar parte</Button>
              {splitParts.length > 0 && <Alert severity={splitValid ? 'success' : splitDifference < 0n ? 'warning' : 'info'}>
                Distribuído: {currency((Number(splitSum) / 100).toFixed(2))}.
                {' '}{splitDifference === 0n ? (splitValid ? 'A soma corresponde ao pagamento. Pronto para salvar.' : 'Preencha todas as partes com valores positivos, descrição e categoria.')
                  : `${splitDifference > 0n ? 'Falta distribuir' : 'O total foi excedido em'} ${currency((Number(splitDifference < 0n ? -splitDifference : splitDifference) / 100).toFixed(2))}.`}
              </Alert>}
              {splitError && <Alert severity="error">{splitError}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={splitBusy} onClick={() => setSplittingExpense(null)}>Cancelar</Button>
            <Button type="submit" variant="contained" disabled={splitBusy || !splitValid}>{splitBusy ? 'Salvando…' : 'Salvar divisão'}</Button>
          </DialogActions>
        </Box>
      </Dialog>
      <Dialog open={editingExpense !== null} fullWidth maxWidth="sm" onClose={() => { if (!savingEdit) setEditingExpense(null); }}>
        <Box component="form" onSubmit={saveEdit}>
          <DialogTitle>Editar lançamento</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Descrição" required fullWidth value={editForm.description} disabled={savingEdit}
                slotProps={{ htmlInput: { maxLength: 200 } }} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Valor (R$)" required fullWidth value={editForm.amount} disabled={savingEdit || !!editingExpense?.split_id}
                  slotProps={{ htmlInput: { inputMode: 'decimal', pattern: '[0-9]+([.,][0-9]{1,2})?' } }}
                  onChange={(event) => setEditForm({ ...editForm, amount: event.target.value })} />
                <TextField label="Data" type="date" required fullWidth value={editForm.date} disabled={savingEdit || !!editingExpense?.split_id}
                  slotProps={{ inputLabel: { shrink: true } }} onChange={(event) => setEditForm({ ...editForm, date: event.target.value })} />
              </Stack>
              {editingExpense?.split_id && <Typography variant="body2" color="text.secondary">
                Este lançamento é parte de um pagamento dividido. Para redistribuir os valores, use Editar divisão na tabela.
                A data do pagamento original é preservada.
              </Typography>}
              <TextField label="Categoria" select required fullWidth value={editForm.category} disabled={savingEdit}
                onChange={(event) => setEditForm({ ...editForm, category: event.target.value,
                  devendo_type: isDevendo({ category: event.target.value }) ? editForm.devendo_type : 'personal' })}>
                {categories.map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
              </TextField>
              {isDevendo(editForm) && <DevendoTypeField value={editForm.devendo_type} disabled={savingEdit}
                onChange={(value) => setEditForm({ ...editForm, devendo_type: value })} />}
              {editError && <Alert severity="error">{editError}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={savingEdit} onClick={() => setEditingExpense(null)}>Cancelar</Button>
            <Button type="submit" variant="contained" disabled={savingEdit}>{savingEdit ? 'Salvando…' : 'Salvar'}</Button>
          </DialogActions>
        </Box>
      </Dialog>
      <Dialog open={selected !== null} onClose={() => { if (!deleting) setSelected(null); }}>
        <DialogTitle>{selected?.split_id ? 'Excluir pagamento dividido?' : 'Excluir lançamento?'}</DialogTitle>
        <DialogContent>
          {selected?.split_id
            ? `Todas as partes do pagamento “${selected.split_description}”, no total de ${currency(selected.split_total ?? selected.amount)}, serão excluídas permanentemente.`
            : `O lançamento “${selected?.description}” será excluído permanentemente.`}
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setSelected(null)}>Cancelar</Button>
          <Button color="error" disabled={deleting} onClick={remove}>{deleting ? 'Excluindo…' : 'Excluir'}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={categoryToDelete !== null} onClose={() => { if (!categoryBusy) setCategoryToDelete(null); }}>
        <DialogTitle>Excluir categoria?</DialogTitle>
        <DialogContent>
          {categoryError && <Alert severity="error" sx={{ mb: 2 }}>{categoryError}</Alert>}
          A categoria “{categoryToDelete}” será removida. Essa ação não pode ser desfeita.
        </DialogContent>
        <DialogActions>
          <Button disabled={categoryBusy} onClick={() => setCategoryToDelete(null)}>Cancelar</Button>
          <Button color="error" disabled={categoryBusy} onClick={deleteCategory}>
            {categoryBusy ? 'Excluindo…' : 'Excluir categoria'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
