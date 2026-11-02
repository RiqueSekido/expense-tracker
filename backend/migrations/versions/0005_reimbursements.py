"""Track personal spending and its repayments separately from routine expenses."""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.add_column(sa.Column("personal_expense", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("reimbursement_for_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_expenses_reimbursement", "expenses", ["reimbursement_for_id"], ["id"], ondelete="RESTRICT")
        batch.create_index("ix_expenses_reimbursement_for_id", ["reimbursement_for_id"])
        batch.create_check_constraint("personal_expense_is_debit", "NOT personal_expense OR kind = 'expense'")
        batch.create_check_constraint("reimbursement_is_credit", "reimbursement_for_id IS NULL OR (kind = 'income' AND reimbursement_for_id <> id)")
    op.execute("UPDATE expenses SET personal_expense = true WHERE kind = 'expense' AND lower(trim(category)) = 'devendo'")


def downgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.drop_constraint("reimbursement_is_credit", type_="check")
        batch.drop_constraint("personal_expense_is_debit", type_="check")
        batch.drop_index("ix_expenses_reimbursement_for_id")
        batch.drop_constraint("fk_expenses_reimbursement", type_="foreignkey")
        batch.drop_column("reimbursement_for_id")
        batch.drop_column("personal_expense")
