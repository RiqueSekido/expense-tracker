import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, Dialog,
  DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import { request, type Expense, type NewExpense, type Summary } from './api';

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const emptyForm = (): NewExpense => ({ description: '', amount: '', date: localDate(), category: 'Alimentação' });
const categories = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação', 'Lazer', 'Outros'];
const currency = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const errorMessage = (error: unknown) => error instanceof TypeError
  ? 'Não foi possível conectar à API. Confira se o backend está em execução.'
  : error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';

export default function App() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Expense | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSummary(null);
    setExpenses([]);
    setError('');
    Promise.all([
      request<Expense[]>(`/expenses?month=${month}`, { signal: controller.signal }),
      request<Summary>(`/expenses/summary?month=${month}`, { signal: controller.signal }),
    ]).then(([items, totals]) => {
      setExpenses(items);
      setSummary(totals);
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
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Paper variant="outlined" sx={{ p: 3, flex: 1 }}>
            <Typography color="text.secondary">Total do mês</Typography>
            <Typography variant="h3" component="p" fontWeight={700} color="primary" sx={{ mt: 1 }}>{summary ? currency(summary.total) : '—'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{summary ? `${summary.count} lançamento(s)` : 'Aguardando dados'}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 3, minWidth: 240 }}>
            <TextField label="Mês de referência" type="month" value={month} fullWidth
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: '0001-01', max: '9998-12' } }}
              onChange={(e) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }} />
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
                <TextField label="Categoria" select value={form.category} fullWidth onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {categories.map((category) => <MenuItem key={category} value={category}>{category}</MenuItem>)}
                </TextField>
              </Stack>
              <Button type="submit" variant="contained" disabled={saving} sx={{ alignSelf: 'flex-start' }}>{saving ? 'Salvando…' : 'Adicionar gasto'}</Button>
            </Stack>
          </Box>
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
                <TableCell><Chip size="small" label={expense.category} /></TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{expense.date.split('-').reverse().join('/')}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{currency(expense.amount)}</TableCell>
                <TableCell align="right"><Button color="error" aria-label={`Excluir ${expense.description}`} onClick={() => setSelected(expense)}>Excluir</Button></TableCell>
              </TableRow>)}</TableBody>
            </Table></TableContainer>}
        </Paper>
      </Stack>
      <Dialog open={selected !== null} onClose={() => { if (!deleting) setSelected(null); }}>
        <DialogTitle>Excluir gasto?</DialogTitle>
        <DialogContent>O lançamento “{selected?.description}” será excluído permanentemente.</DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setSelected(null)}>Cancelar</Button>
          <Button color="error" disabled={deleting} onClick={remove}>{deleting ? 'Excluindo…' : 'Excluir'}</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
