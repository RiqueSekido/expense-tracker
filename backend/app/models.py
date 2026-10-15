from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Category(Base):
    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(String(60), primary_key=True)


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="positive_expense_amount"),
        Index("ix_expenses_date", "date"),
        Index("ix_expenses_import_key", "import_key", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(
        String(60), ForeignKey("categories.name", name="fk_expenses_category_categories")
    )
    source_description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_document: Mapped[str | None] = mapped_column(String(100), nullable=True)
    import_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
