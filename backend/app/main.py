import os
import csv
import hashlib
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_session
from .models import Category, Expense
from .schemas import (
    CategoryCreate, CategoryRead, ExpenseCreate, ExpenseImport, ExpenseRead,
    ExpenseSummary, ImportPreview,
)

app = FastAPI(title="Controle de gastos", version="0.1.0")
frontend_origins = {
    os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(frontend_origins),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)
Database = Annotated[Session, Depends(get_session)]
Month = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


def month_bounds(month: str) -> tuple[date, date]:
    year, number = map(int, month.split("-"))
    try:
        start = date(year, number, 1)
        end = date(year + (number == 12), number % 12 + 1, 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Mês inválido.")
    return start, end


def _normalize_header(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char)).strip().lower()


def _parse_bb_csv(content: str) -> ImportPreview:
    # Some BB exports wrap and escape each complete CSV line. Unwrap that
    # representation before passing the actual fields to Python's CSV reader.
    normalized_lines = []
    for line in content.splitlines():
        line = line.strip()
        if line.startswith('"') and line.endswith('"'):
            line = line[1:-1].replace('""', '"')
        normalized_lines.append(line)

    try:
        rows = list(csv.reader(normalized_lines, skipinitialspace=True))
    except csv.Error as exc:
        raise HTTPException(status_code=422, detail="Não foi possível interpretar o CSV do Banco do Brasil.") from exc
    if not rows:
        raise HTTPException(status_code=422, detail="O arquivo CSV está vazio.")

    header = [_normalize_header(value) for value in rows[0]]
    required = {"data", "historico", "valor"}
    if not required.issubset(header):
        raise HTTPException(
            status_code=422,
            detail="Formato não reconhecido. O CSV precisa ter as colunas Data, Histórico e Valor.",
        )
    positions = {name: header.index(name) for name in required}
    document_position = header.index("numero do documento") if "numero do documento" in header else None
    candidates = []
    ignored_rows = 0
    for row_number, row in enumerate(rows[1:], start=2):
        try:
            raw_date = row[positions["data"]].strip()
            description = row[positions["historico"]].strip()
            raw_amount = row[positions["valor"]].strip()
            source_document = row[document_position].strip() if document_position is not None else ""
            if not description or "saldo" in _normalize_header(description):
                ignored_rows += 1
                continue
            amount_text = raw_amount.replace("R$", "").replace(" ", "")
            if "," in amount_text:
                amount_text = amount_text.replace(".", "").replace(",", ".")
            value = Decimal(amount_text)
            if value >= 0:
                ignored_rows += 1
                continue
            transaction_date = datetime.strptime(raw_date, "%d/%m/%Y").date()
            expense_amount = abs(value).quantize(Decimal("0.01"))
            if len(description) > 200 or expense_amount <= 0 or expense_amount >= Decimal("10000000000"):
                ignored_rows += 1
                continue
        except (IndexError, ValueError, ArithmeticError):
            ignored_rows += 1
            continue
        candidates.append({
            "row_number": row_number,
            "description": description,
            "source_description": description,
            "source_document": source_document,
            "amount": expense_amount,
            "date": transaction_date,
            "category": "A classificar",
            "card_payment": "cartao" in _normalize_header(description)
            and any(term in _normalize_header(description) for term in ("pagto", "pagamento", "fatura")),
        })
        if len(candidates) > 1000:
            raise HTTPException(status_code=422, detail="O arquivo contém mais de 1.000 débitos. Divida o extrato em arquivos menores.")
    if not candidates:
        raise HTTPException(status_code=422, detail="Nenhum débito reconhecido foi encontrado no CSV.")
    return ImportPreview(candidates=candidates, ignored_rows=ignored_rows)


def _import_key(item) -> str:
    canonical_description = " ".join(item.source_description.casefold().split())
    fingerprint = "|".join((
        "banco-do-brasil",
        item.date.isoformat(),
        item.source_document.strip(),
        f"{item.amount:.2f}",
        canonical_description,
    ))
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def _has_legacy_duplicate(item, session: Session) -> bool:
    return session.scalar(
        select(Expense.id).where(
            Expense.date == item.date,
            Expense.amount == item.amount,
            func.lower(func.coalesce(Expense.source_description, Expense.description))
            == item.source_description.lower(),
        )
    ) is not None


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/categories", response_model=list[CategoryRead])
def list_categories(session: Database):
    rows = session.execute(
        select(Category.name, func.count(Expense.id).label("expense_count"))
        .outerjoin(Expense, Expense.category == Category.name)
        .group_by(Category.name)
        .order_by(Category.name)
    ).all()
    return [{"name": name, "expense_count": count} for name, count in rows]


@app.post("/api/categories", response_model=CategoryRead, status_code=201)
def create_category(data: CategoryCreate, session: Database):
    existing = session.scalar(
        select(Category).where(func.lower(Category.name) == data.name.lower())
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Essa categoria já existe.")

    category = Category(name=data.name)
    session.add(category)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Essa categoria já existe.")
    session.refresh(category)
    return category


@app.put("/api/categories", response_model=CategoryRead)
def rename_category(
    current_name: Annotated[str, Query(min_length=1, max_length=60)],
    data: CategoryCreate,
    session: Database,
):
    category = session.get(Category, current_name)
    if category is None:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    if data.name == current_name:
        expense_count = session.scalar(
            select(func.count(Expense.id)).where(Expense.category == current_name)
        )
        return {"name": current_name, "expense_count": expense_count}

    duplicate = session.scalar(
        select(Category).where(
            func.lower(Category.name) == data.name.lower(),
            Category.name != current_name,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Já existe uma categoria com esse nome.")

    expense_count = session.scalar(
        select(func.count(Expense.id)).where(Expense.category == current_name)
    )
    renamed = Category(name=data.name)
    session.add(renamed)
    session.flush()
    session.execute(
        update(Expense).where(Expense.category == current_name).values(category=data.name)
    )
    session.delete(category)
    session.commit()
    return {"name": data.name, "expense_count": expense_count}


@app.delete("/api/categories", status_code=204)
def delete_category(
    name: Annotated[str, Query(min_length=1, max_length=60)], session: Database
):
    category_name = name
    category = session.get(Category, category_name)
    if category is None:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    expense_count = session.scalar(
        select(func.count(Expense.id)).where(Expense.category == category_name)
    )
    if expense_count:
        raise HTTPException(
            status_code=409,
            detail="Não é possível excluir uma categoria que possui gastos associados.",
        )
    session.delete(category)
    session.commit()
    return Response(status_code=204)


@app.get("/api/expenses", response_model=list[ExpenseRead])
def list_expenses(month: Month, session: Database):
    start, end = month_bounds(month)
    return session.scalars(
        select(Expense).where(Expense.date >= start, Expense.date < end)
        .order_by(Expense.date.desc(), Expense.id.desc())
    ).all()


@app.get("/api/expenses/summary", response_model=ExpenseSummary)
def expense_summary(month: Month, session: Database):
    start, end = month_bounds(month)
    total, count = session.execute(
        select(func.sum(Expense.amount), func.count(Expense.id))
        .where(Expense.date >= start, Expense.date < end)
    ).one()
    return ExpenseSummary(total=total or Decimal("0.00"), count=count)


@app.post("/api/expenses", response_model=ExpenseRead, status_code=201)
def create_expense(data: ExpenseCreate, session: Database):
    if session.get(Category, data.category) is None:
        # Keep older API clients compatible: using a new category on an expense
        # also makes that category available to the category selector.
        session.add(Category(name=data.category))
        session.flush()
    expense = Expense(**data.model_dump())
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return expense


@app.post("/api/expenses/import/preview", response_model=ImportPreview)
def preview_expense_import(content: Annotated[bytes, Body(media_type="text/csv")], session: Database):
    if not content:
        raise HTTPException(status_code=400, detail="Envie o conteúdo do CSV.")
    if len(content) > 5_000_000:
        raise HTTPException(status_code=413, detail="O CSV deve ter no máximo 5 MB.")
    preview = _parse_bb_csv(content.decode("cp1252"))
    seen: set[str] = set()
    candidates = []
    for item in preview.candidates:
        key = _import_key(item)
        duplicate = (
            key in seen
            or session.scalar(select(Expense.id).where(Expense.import_key == key)) is not None
            or _has_legacy_duplicate(item, session)
        )
        candidates.append(item.model_copy(update={"duplicate": duplicate}))
        seen.add(key)
    return ImportPreview(candidates=candidates, ignored_rows=preview.ignored_rows)


@app.post("/api/expenses/import")
def import_expenses(data: ExpenseImport, session: Database):
    imported = 0
    duplicates = 0
    seen: set[str] = set()
    for item in data.expenses:
        canonical_document = item.source_document.strip()
        import_key = _import_key(item)
        if import_key in seen or session.scalar(
            select(Expense.id).where(Expense.import_key == import_key)
        ) is not None:
            duplicates += 1
            continue
        if _has_legacy_duplicate(item, session):
            duplicates += 1
            continue
        seen.add(import_key)
        if session.get(Category, item.category) is None:
            session.add(Category(name=item.category))
            session.flush()
        session.add(Expense(
            **item.model_dump(exclude={"row_number", "source_description", "source_document"}),
            source_description=item.source_description,
            source_document=canonical_document or None,
            import_key=import_key,
        ))
        imported += 1
    session.commit()
    return {"imported": imported, "duplicates": duplicates}


@app.delete("/api/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int, session: Database):
    expense = session.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=404, detail="Gasto não encontrado.")
    session.delete(expense)
    session.commit()
    return Response(status_code=204)
