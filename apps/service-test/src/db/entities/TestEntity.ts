import { Entity, PrimaryKey, Property, ManyToMany, ManyToOne, EntityManager, wrap, Collection, OneToMany, Cascade } from "@mikro-orm/core";

@Entity({
	tableName: "todo_entity"
})
export class TodoEntity {
	@PrimaryKey()
	id!: number;

	@Property({
    columnType: "varchar(40)",
    nullable: true,
    default: "",
  })
  email: string;
}