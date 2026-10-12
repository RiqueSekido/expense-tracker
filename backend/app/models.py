from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="positive_expense_amount"),
        Index("ix_expenses_date", "date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String(60))
