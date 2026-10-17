import { Role } from "@shared/constants";
import { useEffect, useMemo } from "react";
import { useUsersStore } from "@/stores/users";

export function useTechnicians() {
  const users = useUsersStore((s) => s.users);
  const fetchUsers = useUsersStore((s) => s.fetchUsers);
  const isLoading = useUsersStore((s) => s.isLoading);

  useEffect(() => {
    if (users.length === 0 && !isLoading) {
      fetchUsers();
    }
  }, [users.length, isLoading, fetchUsers]);

  const technicians = useMemo(
    () =>
      users
        .filter(
          (u) =>
            u.isActive && (u.role === Role.TECHNICIAN || u.role === Role.OWNER)
        )
        .map((u) => ({ id: u.id, name: u.name || u.username })),
    [users]
  );

  return { isLoading, technicians };
}
