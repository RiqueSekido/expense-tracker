"""Preserve the original payment when dividing expenses into categories."""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "expense_splits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("source_description", sa.String(200), nullable=True),
        sa.Column("source_document", sa.String(100), nullable=True),
        sa.Column("import_key", sa.String(64), nullable=True, unique=True),
        sa.CheckConstraint("amount > 0", name="positive_split_amount"),
    )
    with op.batch_alter_table("expenses") as batch:
        batch.add_column(sa.Column("split_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_expenses_split", "expense_splits", ["split_id"], ["id"], ondelete="RESTRICT")
        batch.create_index("ix_expenses_split_id", ["split_id"])


def downgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.drop_index("ix_expenses_split_id")
        batch.drop_constraint("fk_expenses_split", type_="foreignkey")
        batch.drop_column("split_id")
    op.drop_table("expense_splits")
