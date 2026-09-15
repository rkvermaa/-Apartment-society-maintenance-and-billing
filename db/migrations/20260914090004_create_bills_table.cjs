exports.up = function up(knex) {
  return knex.schema.createTable('bills', (table) => {
    table.increments('id').primary();
    table.integer('flat_id').unsigned().notNullable()
      .references('id').inTable('flats').onDelete('CASCADE');
    table.string('billing_period').notNullable();
    table.decimal('amount', 10, 2).notNullable();
    table.date('due_date').notNullable();
    table.string('status').notNullable().defaultTo('pending');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('bills');
};
