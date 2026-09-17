exports.up = function up(knex) {
  return knex.schema.createTable('audit_logs', (table) => {
    table.increments('id').primary();
    table.string('action').notNullable();
    table.integer('target_user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('target_email').notNullable();
    table.string('performed_by').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('audit_logs');
};
