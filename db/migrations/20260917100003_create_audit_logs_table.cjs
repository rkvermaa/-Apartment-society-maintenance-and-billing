exports.up = function up(knex) {
  return knex.schema.createTable('audit_logs', (table) => {
    table.increments('id').primary();
    table.integer('admin_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.string('action_type').notNullable();
    table.integer('resident_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('audit_logs');
};
