from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Numeric, String, false
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Category(Base):
    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(String(60), primary_key=True)


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    __table_args__ = (CheckConstraint("amount > 0", name="positive_split_amount"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    date: Mapped[date] = mapped_column(Date)
    source_description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_document: Mapped[str | None] = mapped_column(String(100), nullable=True)
    import_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="positive_expense_amount"),
        CheckConstraint("kind IN ('income', 'expense')", name="valid_expense_kind"),
        CheckConstraint("devendo_type IN ('personal', 'salary')", name="valid_devendo_type"),
        CheckConstraint("NOT personal_expense OR kind = 'expense'", name="personal_expense_is_debit"),
        CheckConstraint("reimbursement_for_id IS NULL OR (kind = 'income' AND reimbursement_for_id <> id)", name="reimbursement_is_credit"),
        Index("ix_expenses_date", "date"),
        Index("ix_expenses_import_key", "import_key", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(200))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    kind: Mapped[str] = mapped_column(String(7), default="expense", server_default="expense")
    devendo_type: Mapped[str] = mapped_column(String(8), default="personal", server_default="personal")
    devendo_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    personal_expense: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    reimbursement_for_id: Mapped[int | None] = mapped_column(
        ForeignKey("expenses.id", name="fk_expenses_reimbursement", ondelete="RESTRICT"), index=True,
    )
    date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(
        String(60), ForeignKey("categories.name", name="fk_expenses_category_categories")
    )
    source_description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_document: Mapped[str | None] = mapped_column(String(100), nullable=True)
    import_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    split_id: Mapped[int | None] = mapped_column(
        ForeignKey("expense_splits.id", name="fk_expenses_split", ondelete="RESTRICT"), index=True,
    )
