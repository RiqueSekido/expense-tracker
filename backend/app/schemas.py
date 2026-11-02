from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class ExpenseCreate(BaseModel):
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    date: date
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    personal_expense: bool = False
    devendo_type: Literal["personal", "salary"] = "personal"


class ReimbursementUpdate(BaseModel):
    personal_expense: bool = False
    reimbursement_for_id: int | None = Field(default=None, gt=0)


class DevendoVisibilityUpdate(BaseModel):
    hidden: bool


class ExpenseUpdate(BaseModel):
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    date: date
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    devendo_type: Literal["personal", "salary"] | None = None


class ExpenseSplitPart(BaseModel):
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    devendo_type: Literal["personal", "salary"] = "personal"


class ExpenseSplitRequest(BaseModel):
    parts: list[ExpenseSplitPart] = Field(min_length=2, max_length=10)


class SplitPaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    description: str
    amount: Decimal
    date: date


class CategoryCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class CategoryRead(CategoryCreate):
    model_config = ConfigDict(from_attributes=True)
    expense_count: int = 0


class ExpenseRead(ExpenseCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    devendo_hidden: bool = False
    kind: Literal["income", "expense"] = "expense"
    source_description: str | None = None
    source_document: str | None = None
    reimbursement_for_id: int | None = None
    reimbursed_amount: Decimal = Decimal("0.00")
    pending_amount: Decimal = Decimal("0.00")
    split_id: int | None = None
    split_description: str | None = None
    split_total: Decimal | None = None


class ExpenseSplitRead(BaseModel):
    payment: SplitPaymentRead
    parts: list[ExpenseRead]


class ExpenseSummary(BaseModel):
    total: Decimal
    count: int
    income: Decimal
    balance: Decimal
    routine_total: Decimal
    reimbursements: Decimal
    pending_reimbursement: Decimal


class ImportExpense(ExpenseCreate):
    kind: Literal["income", "expense"] = "expense"
    row_number: int = Field(gt=0)
    source_description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    source_document: Annotated[str, StringConstraints(max_length=100)] = ""
    reimbursement_for_id: int | None = Field(default=None, gt=0)
    reimbursement_for_row_number: int | None = Field(default=None, gt=0)


class ExpenseImport(BaseModel):
    expenses: list[ImportExpense] = Field(min_length=1, max_length=1000)


class ImportCandidate(ExpenseCreate):
    kind: Literal["income", "expense"] = "expense"
    row_number: int
    card_payment: bool
    source_description: str
    source_document: str
    duplicate: bool = False


class ImportPreview(BaseModel):
    candidates: list[ImportCandidate]
    ignored_rows: int
