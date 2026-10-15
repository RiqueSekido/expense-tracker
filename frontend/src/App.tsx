import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Container, Dialog, FormControl,
  DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack,
  Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { previewImport, request, type Category, type Expense, type ImportCandidate, type NewExpense, type Summary } from './api';

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const emptyForm = (): NewExpense => ({ description: '', amount: '', date: localDate(), category: '' });
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
const shiftMonth = (value: string, offset: number) => {
  const [year, month] = value.split('-').map(Number);
  const index = year * 12 + month - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
};
const errorMessage = (error: unknown) => error instanceof TypeError
  ? 'Não foi possível conectar à API. Confira se o backend está em execução.'
  : error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';

export default function App() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [selectedYear, selectedMonth] = month.split('-').map(Number);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 3 + index);
  if (!years.includes(selectedYear)) years.push(selectedYear);
  years.sort((a, b) => a - b);
  const [expenses, setExpenses] = useState<Expense[]>([]);
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
  const [activeTab, setActiveTab] = useState<'expenses' | 'categories'>('expenses');
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
    const controller = new AbortController();
    setLoading(true);
    setSummary(null);
    setExpenses([]);
    setError('');
    Promise.all([
      request<Expense[]>(`/expenses?month=${month}`, { signal: controller.signal }),
      request<Summary>(`/expenses/summary?month=${month}`, { signal: controller.signal }),
      request<Category[]>('/categories', { signal: controller.signal }),
    ]).then(([items, totals, availableCategories]) => {
      setExpenses(items);
      setSummary(totals);
      setCategories(availableCategories);
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
      setSuccess(`Importados ${result.imported} gasto(s); ${result.duplicates} duplicata(s) ignorada(s).`);
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
      setSuccess('Gasto excluído.');
      setReload((value) => value + 1);
    } catch (err) { setError(errorMessage(err)); }
    finally { setDeleting(false); }
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
        <Tabs value={activeTab} onChange={(_, value: 'expenses' | 'categories') => setActiveTab(value)} aria-label="Seções de gastos">
          <Tab value="expenses" label="Gastos" />
          <Tab value="categories" label="Categorias" />
        </Tabs>
        {activeTab === 'expenses' ? <Stack spacing={3}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Paper variant="outlined" sx={{ p: 3, flex: 1 }}>
            <Typography color="text.secondary">Total do mês</Typography>
            <Typography variant="h3" component="p" fontWeight={700} color="primary" sx={{ mt: 1 }}>{summary ? currency(summary.total) : '—'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{summary ? `${summary.count} lançamento(s)` : 'Aguardando dados'}</Typography>
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
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Os valores exibidos correspondem ao mês selecionado.</Typography>
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
                    onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {categories.map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
                  </TextField>
                </Stack>
              </Stack>
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
                Selecione o CSV para revisar os débitos e escolher uma categoria antes de importar.
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
                {importRows.length} débito(s) encontrado(s); {ignoredImportRows} linha(s) de saldo, crédito ou inválida(s) ignorada(s).
                Duplicatas e pagamentos de cartão ficam desmarcados; confira antes de confirmar.
              </Alert>
              <TableContainer>
                <Table size="small" aria-label="Prévia da importação do extrato">
                  <TableHead><TableRow>
                    <TableCell>Importar</TableCell><TableCell>Data</TableCell><TableCell>Descrição para salvar</TableCell>
                    <TableCell align="right">Valor</TableCell><TableCell>Categoria</TableCell>
                  </TableRow></TableHead>
                  <TableBody>{importRows.map((row, index) => <TableRow key={row.row_number}>
                    <TableCell padding="checkbox">
                      <Checkbox checked={row.include} disabled={row.duplicate}
                        onChange={(event) => setImportRows((current) => current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, include: event.target.checked } : item))}
                        inputProps={{ 'aria-label': `Importar ${row.description}` }} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.date.split('-').reverse().join('/')}</TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <TextField size="small" fullWidth required value={row.description}
                        inputProps={{ maxLength: 200, 'aria-label': `Descrição do gasto importado: ${row.source_description}` }}
                        title={`Descrição original do extrato: ${row.source_description}`}
                        onChange={(event) => setImportRows((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, description: event.target.value } : item))} />
                      {row.duplicate && <Chip size="small" color="default" label="Já importado" sx={{ mt: 0.5, mr: 0.5 }} />}
                      {row.card_payment && <Chip size="small" color="warning" label="Pagamento de cartão" sx={{ mt: 0.5 }} />}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(row.amount)}</TableCell>
                    <TableCell>
                      <TextField select size="small" value={row.category} disabled={categories.length === 0}
                        aria-label={`Categoria de ${row.description}`}
                        onChange={(event) => setImportRows((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, category: event.target.value } : item))}>
                        <MenuItem value="">Selecione…</MenuItem>
                        {categories.map((category) => <MenuItem key={category.name} value={category.name}>{category.name}</MenuItem>)}
                      </TextField>
                    </TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </TableContainer>
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
          <Typography variant="h6" component="h2" sx={{ p: 3 }}>Gastos do mês</Typography>
          {loading ? <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress aria-label="Carregando gastos" /></Box>
            : !summary ? <Typography sx={{ p: 3 }} color="text.secondary">Não foi possível carregar os gastos.</Typography>
            : expenses.length === 0 ? <Typography sx={{ p: 3 }} color="text.secondary">Nenhum gasto neste mês. Registre seu primeiro lançamento acima.</Typography>
            : <TableContainer><Table aria-label="Gastos do mês">
              <TableHead><TableRow><TableCell>Descrição</TableCell><TableCell>Categoria</TableCell><TableCell>Data</TableCell><TableCell align="right">Valor</TableCell><TableCell align="right">Ação</TableCell></TableRow></TableHead>
              <TableBody>{expenses.map((expense) => <TableRow key={expense.id}>
                <TableCell sx={{ overflowWrap: 'anywhere', maxWidth: 300 }}>{expense.description}</TableCell>
                <TableCell>
                  <Chip size="small" label={expense.category} sx={{
                    bgcolor: categoryColor(expense.category).background,
                    color: categoryColor(expense.category).foreground,
                    fontWeight: 600,
                  }} />
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{expense.date.split('-').reverse().join('/')}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(expense.amount)}</TableCell>
                <TableCell align="right"><Button color="error" aria-label={`Excluir ${expense.description}`} onClick={() => setSelected(expense)}>Excluir</Button></TableCell>
              </TableRow>)}</TableBody>
            </Table></TableContainer>}
        </Paper>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>Gastos por categoria</Typography>
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
                    {chartSlices.map((slice) => <TableRow key={slice.category} hover>
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
                  </TableBody>
                </Table>
              </TableContainer>
              <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' }, width: '100%' }}>
                {chartSlices.map((slice) => <Stack key={slice.category} spacing={0.5}
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
              </Stack>
            </Stack>}
        </Paper>
        </Stack> : <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h6" component="h2">Gerenciar categorias</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Crie e renomeie categorias. Gastos existentes acompanham o novo nome.
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
              : <TableContainer>
                <Table aria-label="Categorias cadastradas">
                  <TableHead><TableRow>
                    <TableCell>Categoria</TableCell>
                    <TableCell align="right">Gastos associados</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow></TableHead>
                  <TableBody>{categories.map((category) => <TableRow key={category.name}>
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
                            title={category.expense_count > 0 ? 'Esta categoria possui gastos associados.' : undefined}
                            onClick={() => { setCategoryError(''); setCategoryToDelete(category.name); }}>
                            Excluir
                          </Button>
                        </>}
                    </TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </TableContainer>}
            <Typography variant="body2" color="text.secondary">
              Só é possível excluir categorias sem gastos associados.
            </Typography>
          </Stack>
        </Paper>}
      </Stack>
      <Dialog open={selected !== null} onClose={() => { if (!deleting) setSelected(null); }}>
        <DialogTitle>Excluir gasto?</DialogTitle>
        <DialogContent>O lançamento “{selected?.description}” será excluído permanentemente.</DialogContent>
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
