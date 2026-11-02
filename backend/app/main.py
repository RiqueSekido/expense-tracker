import os
import csv
import hashlib
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_session
from .models import Category, Expense, ExpenseSplit
from .schemas import (
    CategoryCreate, CategoryRead, ExpenseCreate, ExpenseImport, ExpenseRead,
    ExpenseSummary, ExpenseUpdate, ImportPreview, ReimbursementUpdate,
    ExpenseSplitRead, ExpenseSplitRequest,
    DevendoVisibilityUpdate,
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


def _validate_devendo_type(category: str, devendo_type: str):
    if devendo_type == "salary" and category.strip().lower() != "devendo":
        raise HTTPException(status_code=422, detail="A classificação Salário só pode ser usada na categoria Devendo.")


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
            if not description or "saldo" in "".join(_normalize_header(description).split()):
                ignored_rows += 1
                continue
            amount_text = raw_amount.replace("R$", "").replace(" ", "")
            if "," in amount_text:
                amount_text = amount_text.replace(".", "").replace(",", ".")
            value = Decimal(amount_text)
            if value == 0:
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
            "kind": "income" if value > 0 else "expense",
            "date": transaction_date,
            "category": "A classificar",
            "card_payment": value < 0 and "cartao" in _normalize_header(description)
            and any(term in _normalize_header(description) for term in ("pagto", "pagamento", "fatura")),
        })
        if len(candidates) > 1000:
            raise HTTPException(status_code=422, detail="O arquivo contém mais de 1.000 lançamentos. Divida o extrato em arquivos menores.")
    if not candidates:
        raise HTTPException(status_code=422, detail="Nenhum lançamento reconhecido foi encontrado no CSV.")
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
    # Preserve existing expense keys while keeping credits distinct from debits.
    if item.kind == "income":
        fingerprint += "|income"
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def _has_legacy_duplicate(item, session: Session) -> bool:
    return session.scalar(
        select(Expense.id).where(
            Expense.date == item.date,
            Expense.amount == item.amount,
            Expense.kind == item.kind,
            Expense.split_id.is_(None),
            func.lower(func.coalesce(Expense.source_description, Expense.description))
            == item.source_description.lower(),
        )
    ) is not None or (item.kind == "expense" and session.scalar(
        select(ExpenseSplit.id).where(
            ExpenseSplit.date == item.date,
            ExpenseSplit.amount == item.amount,
            func.lower(func.coalesce(ExpenseSplit.source_description, ExpenseSplit.description))
            == item.source_description.lower(),
        )
    ) is not None)


def _expense_reads(expenses: list[Expense], session: Session) -> list[ExpenseRead]:
    if not expenses:
        return []
    repaid = dict(session.execute(
        select(Expense.reimbursement_for_id, func.sum(Expense.amount))
        .where(Expense.reimbursement_for_id.in_([item.id for item in expenses]))
        .group_by(Expense.reimbursement_for_id)
    ).all())
    split_ids = {item.split_id for item in expenses if item.split_id is not None}
    splits = {item.id: item for item in session.scalars(select(ExpenseSplit).where(ExpenseSplit.id.in_(split_ids)))} if split_ids else {}
    return [ExpenseRead.model_validate(item).model_copy(update={
        "reimbursed_amount": repaid.get(item.id, Decimal("0.00")),
        "pending_amount": item.amount - repaid.get(item.id, Decimal("0.00"))
        if item.personal_expense else Decimal("0.00"),
        "split_description": splits[item.split_id].description if item.split_id in splits else None,
        "split_total": splits[item.split_id].amount if item.split_id in splits else None,
    }) for item in expenses]


def _locked_expense(expense_id: int, session: Session) -> Expense:
    identity = session.execute(select(Expense.id, Expense.split_id).where(Expense.id == expense_id)).first()
    if identity is None:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    if identity.split_id is not None:
        session.scalar(select(ExpenseSplit).where(ExpenseSplit.id == identity.split_id).with_for_update())
    expense = session.scalar(select(Expense).where(Expense.id == expense_id)
                             .with_for_update().execution_options(populate_existing=True))
    if expense is None:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    if expense.split_id != identity.split_id:
        raise HTTPException(status_code=409, detail="O pagamento foi alterado. Recarregue os lançamentos e tente novamente.")
    return expense


def _set_reimbursement(expense: Expense, data: ReimbursementUpdate, session: Session):
    if data.personal_expense and expense.kind != "expense":
        raise HTTPException(status_code=422, detail="Somente saídas podem ser marcadas como gastos a repor.")
    if not data.personal_expense and expense.personal_expense:
        if session.scalar(select(Expense.id).where(Expense.reimbursement_for_id == expense.id).limit(1)):
            raise HTTPException(status_code=409, detail="Desvincule as reposições antes de retirar a marcação deste gasto.")
    if data.reimbursement_for_id is not None:
        if expense.kind != "income" or data.reimbursement_for_id == expense.id:
            raise HTTPException(status_code=422, detail="Uma reposição deve ser uma entrada vinculada a um gasto pessoal.")
        target = session.scalar(select(Expense).where(Expense.id == data.reimbursement_for_id).with_for_update())
        if target is None or target.kind != "expense" or not target.personal_expense:
            raise HTTPException(status_code=422, detail="Selecione um gasto marcado como a repor.")
        if expense.date < target.date:
            raise HTTPException(status_code=422, detail="A reposição não pode ser anterior ao gasto.")
        already_repaid = session.scalar(select(func.sum(Expense.amount)).where(
            Expense.reimbursement_for_id == target.id, Expense.id != expense.id,
        )) or Decimal("0.00")
        if expense.amount > target.amount - already_repaid:
            raise HTTPException(status_code=422, detail="O valor da entrada supera o valor que falta repor para esse gasto.")
    expense.personal_expense = data.personal_expense
    expense.reimbursement_for_id = data.reimbursement_for_id


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
            detail="Não é possível excluir uma categoria que possui lançamentos associados.",
        )
    session.delete(category)
    session.commit()
    return Response(status_code=204)


@app.get("/api/expenses", response_model=list[ExpenseRead])
def list_expenses(month: Month, session: Database):
    start, end = month_bounds(month)
    rows = session.scalars(
        select(Expense).where(Expense.date >= start, Expense.date < end)
        .order_by(Expense.date.desc(), Expense.id.desc())
    ).all()
    return _expense_reads(rows, session)


@app.get("/api/expenses/reimbursements", response_model=list[ExpenseRead])
def list_reimbursements(session: Database):
    rows = session.scalars(select(Expense).where(Expense.personal_expense.is_(True))
                           .order_by(Expense.date, Expense.id)).all()
    return _expense_reads(rows, session)


@app.get("/api/expenses/devendo", response_model=list[ExpenseRead])
def list_devendo(session: Database):
    rows = session.scalars(select(Expense)
                           .where(func.lower(func.trim(Expense.category)) == "devendo")
                           .order_by(Expense.date.desc(), Expense.id.desc())).all()
    return _expense_reads(rows, session)


@app.get("/api/expenses/summary", response_model=ExpenseSummary)
def expense_summary(month: Month, session: Database):
    start, end = month_bounds(month)
    devendo = func.lower(func.trim(Expense.category)) == "devendo"
    personal = devendo & (Expense.devendo_type == "personal")
    total, income, repayments, salary_income, routine_total, count = session.execute(
        select(
            func.sum(case((Expense.kind == "expense", Expense.amount), else_=0)),
            func.sum(case(((Expense.kind == "income") & ~devendo, Expense.amount), else_=0)),
            func.sum(case(((Expense.kind == "income") & personal, Expense.amount), else_=0)),
            func.sum(case(((Expense.kind == "income") & devendo & (Expense.devendo_type == "salary"), Expense.amount), else_=0)),
            func.sum(case(((Expense.kind == "expense") & ~devendo, Expense.amount), else_=0)),
            func.count(Expense.id),
        )
        .where(Expense.date >= start, Expense.date < end)
    ).one()
    total = total or Decimal("0.00")
    income = income or Decimal("0.00")
    repayments = repayments or Decimal("0.00")
    personal_total = session.scalar(select(func.sum(Expense.amount)).where(personal, Expense.kind == "expense")) or Decimal("0.00")
    repaid_total = session.scalar(select(func.sum(Expense.amount)).where(personal, Expense.kind == "income")) or Decimal("0.00")
    return ExpenseSummary(
        total=total, income=income, reimbursements=repayments, balance=income + repayments + (salary_income or Decimal("0.00")) - total,
        routine_total=routine_total or Decimal("0.00"), count=count,
        pending_reimbursement=personal_total - repaid_total,
    )


@app.put("/api/expenses/{expense_id}/reimbursement", response_model=ExpenseRead)
def update_reimbursement(expense_id: int, data: ReimbursementUpdate, session: Database):
    expense = session.scalar(select(Expense).where(Expense.id == expense_id).with_for_update())
    if expense is None:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    _set_reimbursement(expense, data, session)
    session.commit()
    return _expense_reads([expense], session)[0]


@app.post("/api/expenses", response_model=ExpenseRead, status_code=201)
def create_expense(data: ExpenseCreate, session: Database):
    _validate_devendo_type(data.category, data.devendo_type)
    if session.get(Category, data.category) is None:
        # Keep older API clients compatible: using a new category on an expense
        # also makes that category available to the category selector.
        session.add(Category(name=data.category))
        session.flush()
    expense = Expense(**data.model_dump())
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return _expense_reads([expense], session)[0]


@app.put("/api/expenses/{expense_id}", response_model=ExpenseRead)
def update_expense(expense_id: int, data: ExpenseUpdate, session: Database):
    expense = _locked_expense(expense_id, session)
    devendo_type = data.devendo_type if data.devendo_type is not None else (expense.devendo_type if data.category.strip().lower() == "devendo" else "personal")
    _validate_devendo_type(data.category, devendo_type)
    if expense.split_id is not None and (data.amount != expense.amount or data.date != expense.date):
        raise HTTPException(status_code=422, detail="Para alterar os valores de um pagamento dividido, use Editar divisão. A data do pagamento original é preservada.")
    if session.get(Category, data.category) is None:
        raise HTTPException(status_code=422, detail="Selecione uma categoria cadastrada.")
    for field, value in data.model_dump(exclude={"devendo_type"}).items():
        setattr(expense, field, value)
    expense.devendo_type = devendo_type
    session.commit()
    return _expense_reads([expense], session)[0]


@app.put("/api/expenses/{expense_id}/devendo-visibility", response_model=ExpenseRead)
def update_devendo_visibility(expense_id: int, data: DevendoVisibilityUpdate, session: Database):
    expense = _locked_expense(expense_id, session)
    if data.hidden and (expense.category.strip().lower() != "devendo" or expense.devendo_type != "personal"):
        raise HTTPException(status_code=422, detail="Somente lançamentos pessoais de Devendo podem ser ocultados nesta tabela.")
    expense.devendo_hidden = data.hidden
    session.commit()
    return _expense_reads([expense], session)[0]


@app.get("/api/expenses/{expense_id}/split", response_model=ExpenseSplitRead)
def read_expense_split(expense_id: int, session: Database):
    expense = session.get(Expense, expense_id)
    if expense is None or expense.split_id is None:
        raise HTTPException(status_code=404, detail="Divisão não encontrada.")
    payment = session.get(ExpenseSplit, expense.split_id)
    parts = session.scalars(select(Expense).where(Expense.split_id == payment.id).order_by(Expense.id)).all()
    return {"payment": payment, "parts": _expense_reads(parts, session)}


@app.post("/api/expenses/{expense_id}/split", response_model=ExpenseSplitRead)
def split_expense(expense_id: int, data: ExpenseSplitRequest, session: Database):
    expense = _locked_expense(expense_id, session)
    if expense.kind != "expense":
        raise HTTPException(status_code=422, detail="Somente saídas podem ser divididas.")
    payment = session.get(ExpenseSplit, expense.split_id) if expense.split_id is not None else None
    total = payment.amount if payment else expense.amount
    if sum((part.amount for part in data.parts), Decimal("0.00")) != total:
        raise HTTPException(status_code=422, detail="A soma das partes deve ser igual ao valor total do pagamento.")
    for part in data.parts:
        _validate_devendo_type(part.category, part.devendo_type)
        if session.get(Category, part.category) is None:
            raise HTTPException(status_code=422, detail="Selecione uma categoria cadastrada para cada parte.")
    if payment is None:
        payment = ExpenseSplit(
            description=expense.description, amount=expense.amount, date=expense.date,
            source_description=expense.source_description, source_document=expense.source_document,
            import_key=expense.import_key,
        )
        session.add(payment)
        session.flush()
        existing = [expense]
    else:
        existing = session.scalars(select(Expense).where(Expense.split_id == payment.id).order_by(Expense.id)).all()
    parts = []
    for index, part in enumerate(data.parts):
        target = existing[index] if index < len(existing) else Expense(kind="expense", date=payment.date)
        target.description = part.description
        target.amount = part.amount
        target.category = part.category
        target.devendo_type = part.devendo_type
        target.split_id = payment.id
        target.source_description = payment.source_description
        target.source_document = payment.source_document
        session.add(target)
        parts.append(target)
    removed_ids = [item.id for item in existing[len(data.parts):]]
    if removed_ids:
        session.execute(update(Expense).where(Expense.reimbursement_for_id.in_(removed_ids)).values(reimbursement_for_id=None))
        session.execute(delete(Expense).where(Expense.id.in_(removed_ids)))
    session.commit()
    return {"payment": payment, "parts": _expense_reads(parts, session)}


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
            or session.scalar(select(ExpenseSplit.id).where(ExpenseSplit.import_key == key)) is not None
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
    created = {}
    row_numbers = [item.row_number for item in data.expenses]
    if len(row_numbers) != len(set(row_numbers)):
        raise HTTPException(status_code=422, detail="Existem números de linha repetidos na importação.")
    for item in data.expenses:
        _validate_devendo_type(item.category, item.devendo_type)
        canonical_document = item.source_document.strip()
        import_key = _import_key(item)
        if import_key in seen or session.scalar(
            select(Expense.id).where(Expense.import_key == import_key)
        ) is not None or session.scalar(select(ExpenseSplit.id).where(ExpenseSplit.import_key == import_key)) is not None:
            duplicates += 1
            continue
        if _has_legacy_duplicate(item, session):
            duplicates += 1
            continue
        seen.add(import_key)
        if session.get(Category, item.category) is None:
            session.add(Category(name=item.category))
            session.flush()
        if item.personal_expense and item.kind != "expense":
            raise HTTPException(status_code=422, detail="Somente saídas podem ser marcadas como gastos a repor.")
        expense = Expense(
            **item.model_dump(exclude={"row_number", "source_description", "source_document", "reimbursement_for_id", "reimbursement_for_row_number"}),
            source_description=item.source_description,
            source_document=canonical_document or None,
            import_key=import_key,
        )
        session.add(expense)
        created[item.row_number] = expense
        imported += 1
    session.flush()
    for item in data.expenses:
        expense = created.get(item.row_number)
        if expense is None:
            continue
        target_id = item.reimbursement_for_id
        if item.reimbursement_for_row_number is not None:
            target = created.get(item.reimbursement_for_row_number)
            if target_id is not None or target is None:
                raise HTTPException(status_code=422, detail="O gasto a repor precisa estar selecionado na importação, sem duplicidade de vínculo.")
            target_id = target.id
        _set_reimbursement(expense, ReimbursementUpdate(
            personal_expense=item.personal_expense, reimbursement_for_id=target_id,
        ), session)
        session.flush()
    session.commit()
    return {"imported": imported, "duplicates": duplicates}


@app.delete("/api/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int, session: Database):
    expense = _locked_expense(expense_id, session)
    if expense.split_id is not None:
        payment = session.get(ExpenseSplit, expense.split_id)
        part_ids = select(Expense.id).where(Expense.split_id == payment.id)
        session.execute(update(Expense).where(Expense.reimbursement_for_id.in_(part_ids)).values(reimbursement_for_id=None))
        session.execute(delete(Expense).where(Expense.split_id == payment.id))
        session.delete(payment)
        session.commit()
        return Response(status_code=204)
    # Legacy repayment links must not prevent managing category-based entries.
    session.execute(update(Expense).where(Expense.reimbursement_for_id == expense.id)
                    .values(reimbursement_for_id=None))
    session.delete(expense)
    session.commit()
    return Response(status_code=204)
