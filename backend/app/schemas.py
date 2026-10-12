from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class ExpenseCreate(BaseModel):
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    date: date
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class ExpenseRead(ExpenseCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class ExpenseSummary(BaseModel):
    total: Decimal
    count: int
