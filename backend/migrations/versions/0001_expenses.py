"""Create expenses table."""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "expenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("category", sa.String(60), nullable=False),
        sa.CheckConstraint("amount > 0", name="positive_expense_amount"),
    )
    op.create_index("ix_expenses_date", "expenses", ["date"])


def downgrade():
    op.drop_index("ix_expenses_date", table_name="expenses")
    op.drop_table("expenses")
