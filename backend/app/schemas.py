from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class ExpenseCreate(BaseModel):
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    date: date
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class CategoryCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class CategoryRead(CategoryCreate):
    model_config = ConfigDict(from_attributes=True)
    expense_count: int = 0


class ExpenseRead(ExpenseCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_description: str | None = None
    source_document: str | None = None


class ExpenseSummary(BaseModel):
    total: Decimal
    count: int


class ImportExpense(ExpenseCreate):
    row_number: int = Field(gt=0)
    source_description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    source_document: Annotated[str, StringConstraints(max_length=100)] = ""


class ExpenseImport(BaseModel):
    expenses: list[ImportExpense] = Field(min_length=1, max_length=1000)


class ImportCandidate(ExpenseCreate):
    row_number: int
    card_payment: bool
    source_description: str
    source_document: str
    duplicate: bool = False


class ImportPreview(BaseModel):
    candidates: list[ImportCandidate]
    ignored_rows: int
