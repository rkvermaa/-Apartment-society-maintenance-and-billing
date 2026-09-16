exports.up = function up(knex) {
  return knex.schema.createTable('payments', (table) => {
    table.increments('id').primary();
    table.integer('bill_id').unsigned().notNullable()
      .references('id').inTable('bills').onDelete('CASCADE');
    table.decimal('amount', 10, 2).notNullable();
    table.timestamp('paid_at').notNullable();
    table.string('method').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('payments');
};
