import os
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import get_session
from .models import Expense
from .schemas import ExpenseCreate, ExpenseRead, ExpenseSummary

app = FastAPI(title="Controle de gastos", version="0.1.0")
frontend_origins = {
    os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(frontend_origins),
    allow_methods=["GET", "POST", "DELETE"],
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


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
    expense = Expense(**data.model_dump())
    session.add(expense)
    session.commit()
    session.refresh(expense)
    return expense


@app.delete("/api/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int, session: Database):
    expense = session.get(Expense, expense_id)
    if expense is None:
        raise HTTPException(status_code=404, detail="Gasto não encontrado.")
    session.delete(expense)
    session.commit()
    return Response(status_code=204)
