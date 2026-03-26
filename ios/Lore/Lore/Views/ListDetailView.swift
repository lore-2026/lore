import SwiftUI

struct ListDetailView: View {
    let listId: String
    let uid: String

    @State private var list: CustomList?
    @State private var isLoading = true
    @State private var error: String?
    @State private var showEditSheet = false
    @State private var showDeleteConfirm = false

    @Environment(AuthViewModel.self) private var authVM
    private let db = FirestoreService.shared
    private let tmdb = TMDBService.shared

    var isOwner: Bool { authVM.currentUser?.id == uid }

    var body: some View {
        ZStack {
            Color(hex: "#141218").ignoresSafeArea()

            if isLoading {
                ProgressView().tint(.white)
            } else if let list {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        // List metadata
                        VStack(alignment: .leading, spacing: 8) {
                            Text(list.name)
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(.white)
                            if !list.description.isEmpty {
                                Text(list.description)
                                    .font(.system(size: 14))
                                    .foregroundStyle(.white.opacity(0.6))
                            }
                            HStack {
                                Image(systemName: list.visibility == .publicList ? "globe" : "lock.fill")
                                    .font(.system(size: 12))
                                Text(list.visibility.displayName)
                                    .font(.system(size: 13))
                                Text("·")
                                Text("\(list.items.count) items")
                                    .font(.system(size: 13))
                            }
                            .foregroundStyle(.white.opacity(0.5))
                        }
                        .padding(.horizontal, 16)

                        Divider().background(Color(hex: "#2a2930"))

                        // Items
                        LazyVStack(spacing: 0) {
                            ForEach(list.items) { item in
                                HStack(spacing: 12) {
                                    PosterThumbnail(path: item.mediaItem?.posterPath)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(item.mediaItem?.title ?? item.mediaId)
                                            .font(.system(size: 15, weight: .medium))
                                            .foregroundStyle(.white)
                                        if let year = item.mediaItem?.releaseYear {
                                            Text(year).font(.system(size: 13)).foregroundStyle(.white.opacity(0.5))
                                        }
                                    }

                                    Spacer()

                                    if isOwner {
                                        Button(action: { removeItem(item) }) {
                                            Image(systemName: "minus.circle")
                                                .foregroundStyle(.white.opacity(0.4))
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)

                                Divider().background(Color(hex: "#2a2930")).padding(.leading, 76)
                            }
                        }
                    }
                    .padding(.top, 16)
                }
            } else if let error {
                Text(error).foregroundStyle(.white.opacity(0.5))
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(hex: "#141218"), for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            if isOwner {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(action: { showEditSheet = true }) {
                            Label("Edit", systemImage: "pencil")
                        }
                        Button(role: .destructive, action: { showDeleteConfirm = true }) {
                            Label("Delete List", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .foregroundStyle(.white)
                    }
                }
            }
        }
        .task { await loadList() }
        .alert("Delete List?", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive) { Task { await deleteList() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This action cannot be undone.")
        }
        .sheet(isPresented: $showEditSheet) {
            EditListSheetWrapper(initialList: list) { updated in
                Task { await saveEdit(updated) }
            }
        }
    }

    private func loadList() async {
        isLoading = true
        defer { isLoading = false }

        do {
            guard let (id, data) = try await db.getDocument(path: "users/\(uid)/customLists/\(listId)") else {
                error = "List not found"
                return
            }
            var loaded = CustomList.from(id: id, data: data)

            // Enrich items with TMDB data
            if var loaded {
                var enriched = loaded.items
                await withTaskGroup(of: (Int, MediaItem?).self) { group in
                    for (idx, item) in enriched.enumerated() {
                        group.addTask {
                            guard let mediaId = Int(item.mediaId) else { return (idx, nil) }
                            let media = try? await TMDBService.shared.fetchDetails(mediaType: item.mediaType, id: mediaId)
                            return (idx, media)
                        }
                    }
                    for await (idx, media) in group {
                        enriched[idx].mediaItem = media
                    }
                }
                loaded.items = enriched
                list = loaded
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func removeItem(_ item: ListItem) {
        guard var current = list else { return }
        current.items.removeAll { $0.id == item.id }
        list = current
        Task {
            try? await db.updateDocument(
                path: "users/\(uid)/customLists/\(listId)",
                fields: ["items": current.items.map { $0.toDict() }],
                mask: ["items"]
            )
        }
    }

    private func saveEdit(_ updated: CustomList) async {
        list = updated
        try? await db.updateDocument(
            path: "users/\(uid)/customLists/\(listId)",
            fields: [
                "name": updated.name,
                "description": updated.description,
                "visibility": updated.visibility.rawValue
            ],
            mask: ["name", "description", "visibility"]
        )
    }

    private func deleteList() async {
        try? await db.deleteDocument(path: "users/\(uid)/customLists/\(listId)")
    }
}

// MARK: - Edit list wrapper (provides @State binding)

struct EditListSheetWrapper: View {
    let initialList: CustomList?
    let onSave: (CustomList) -> Void
    @State private var editableList: CustomList?

    var body: some View {
        Group {
            if let _ = editableList {
                EditListSheet(list: Binding(
                    get: { editableList! },
                    set: { editableList = $0 }
                ), onSave: onSave)
            }
        }
        .onAppear { editableList = initialList }
    }
}

// MARK: - Edit list sheet

struct EditListSheet: View {
    @Binding var list: CustomList
    let onSave: (CustomList) -> Void
    @State private var name: String
    @State private var description: String
    @State private var visibility: ListVisibility
    @Environment(\.dismiss) private var dismiss

    init(list: Binding<CustomList>, onSave: @escaping (CustomList) -> Void) {
        _list = list
        self.onSave = onSave
        _name = State(initialValue: list.wrappedValue.name)
        _description = State(initialValue: list.wrappedValue.description)
        _visibility = State(initialValue: list.wrappedValue.visibility)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(hex: "#141218").ignoresSafeArea()
                VStack(spacing: 16) {
                    TextField("List name", text: $name)
                        .textFieldStyle(.plain)
                        .foregroundStyle(.white)
                        .padding(14)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "#2a2930")))

                    TextField("Description (optional)", text: $description)
                        .textFieldStyle(.plain)
                        .foregroundStyle(.white)
                        .padding(14)
                        .background(Color(hex: "#1c1b21"))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: "#2a2930")))

                    Picker("Visibility", selection: $visibility) {
                        ForEach(ListVisibility.allCases, id: \.self) { v in
                            Text(v.displayName).tag(v)
                        }
                    }
                    .pickerStyle(.segmented)

                    Spacer()
                }
                .padding(24)
            }
            .navigationTitle("Edit List")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var updated = list
                        updated.name = name
                        updated.description = description
                        updated.visibility = visibility
                        onSave(updated)
                        dismiss()
                    }
                    .disabled(name.isEmpty)
                }
            }
        }
    }
}
