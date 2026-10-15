"""Add user-created categories and preserve existing expense categories."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "categories",
        sa.Column("name", sa.String(60), primary_key=True),
    )
    op.execute(
        "INSERT INTO categories (name) SELECT DISTINCT category FROM expenses"
    )
    with op.batch_alter_table("expenses") as batch_op:
        batch_op.create_foreign_key(
            "fk_expenses_category_categories", "categories", ["category"], ["name"]
        )


def downgrade():
    with op.batch_alter_table("expenses") as batch_op:
        batch_op.drop_constraint("fk_expenses_category_categories", type_="foreignkey")
    op.drop_table("categories")
