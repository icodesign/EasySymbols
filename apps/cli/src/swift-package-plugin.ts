/**
 * SwiftPM sources emitted by the collection exporter.
 *
 * The plugin deliberately only selects already-converted symbolsets. SVG
 * normalization remains EasySymbols core's responsibility; the SwiftPM build
 * step owns resource selection and generated accessors.
 */

export function buildToolPluginSwift(
  pluginTargetName: string,
  generatorTargetName: string,
  manifestFileName: string,
): string {
  return String.raw`import Foundation
import PackagePlugin

private struct PluginManifest: Decodable {
    let symbols: [PluginSymbol]
}

private struct PluginSymbol: Decodable {
    let source: String
}

@main
struct ${pluginTargetName}: BuildToolPlugin {
    func createBuildCommands(
        context: PluginContext,
        target: Target,
    ) throws -> [Command] {
        guard let sourceTarget = target as? SourceModuleTarget else {
            return []
        }

        let generator = try context.tool(named: "${generatorTargetName}")
        let manifest = context.package.directory.appending("${manifestFileName}")
        let sources = context.package.directory.appending("SymbolSources")
        let output = context.pluginWorkDirectory.appending("Generated")
        let generatedSource = output.appending("GeneratedSymbols.swift")
        let generatedCatalog = output.appending("\(sourceTarget.name).xcassets")
        let inputFiles = try inputFiles(
            manifest: manifest,
            sourceRoot: sources,
        )

        return [
            .buildCommand(
                displayName: "Generate ${pluginTargetName} symbol resources",
                executable: generator.path,
                arguments: [
                    manifest.string,
                    sources.string,
                    output.string,
                    sourceTarget.name,
                ],
                inputFiles: inputFiles,
                outputFiles: [generatedSource, generatedCatalog],
            )
        ]
    }

    private func inputFiles(manifest: Path, sourceRoot: Path) throws -> [Path] {
        let manifestURL = URL(fileURLWithPath: manifest.string)
        let sourceRootURL = URL(fileURLWithPath: sourceRoot.string).standardizedFileURL
        let data = try Data(contentsOf: manifestURL)
        let selection = try JSONDecoder().decode(PluginManifest.self, from: data)
        var paths = [manifest]
        let fileManager = FileManager.default

        for symbol in selection.symbols {
            let sourceURL = sourceRootURL
                .appendingPathComponent(symbol.source)
                .standardizedFileURL
            guard sourceURL.path == sourceRootURL.path || sourceURL.path.hasPrefix(sourceRootURL.path + "/") else {
                throw NSError(domain: "EasySymbolsPlugin", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Symbol source escapes SymbolSources: \(symbol.source)"
                ])
            }
            guard fileManager.fileExists(atPath: sourceURL.path) else {
                throw NSError(domain: "EasySymbolsPlugin", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "Missing symbol source: \(symbol.source)"
                ])
            }
            if let enumerator = fileManager.enumerator(
                at: sourceURL,
                includingPropertiesForKeys: [.isRegularFileKey],
            ) {
                for case let fileURL as URL in enumerator {
                    if (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
                        paths.append(Path(fileURL.path))
                    }
                }
            }
        }
        return paths
    }
}
`;
}

export function resourceGeneratorSwift(): string {
  return String.raw`import Foundation

private struct CollectionManifest: Decodable {
    let symbols: [CollectionSymbol]
}

private struct CollectionSymbol: Decodable {
    let name: String?
    let source: String
}

private enum GeneratorError: LocalizedError {
    case usage
    case invalidManifest(String)
    case invalidSource(String)
    case duplicateName(String)

    var errorDescription: String? {
        switch self {
        case .usage:
            return "usage: EasySymbolsResourceGenerator <manifest> <symbol-sources> <output> <target-name>"
        case let .invalidManifest(message):
            return "Invalid collection manifest: \(message)"
        case let .invalidSource(message):
            return "Invalid symbol source: \(message)"
        case let .duplicateName(name):
            return "Duplicate symbol name in collection manifest: \(name)"
        }
    }
}

@main
struct EasySymbolsResourceGenerator {
    static func main() throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.count == 4 else {
            throw GeneratorError.usage
        }

        let manifestURL = URL(fileURLWithPath: arguments[0])
        let sourceRootURL = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        let outputURL = URL(fileURLWithPath: arguments[2])
        let targetName = arguments[3]

        let manifestData = try Data(contentsOf: manifestURL)
        let manifest: CollectionManifest
        do {
            manifest = try JSONDecoder().decode(CollectionManifest.self, from: manifestData)
        } catch {
            throw GeneratorError.invalidManifest(error.localizedDescription)
        }
        guard !manifest.symbols.isEmpty else {
            throw GeneratorError.invalidManifest("symbols must not be empty")
        }
        guard !targetName.isEmpty else {
            throw GeneratorError.invalidManifest("target name must not be empty")
        }

        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: outputURL.path) {
            try fileManager.removeItem(at: outputURL)
        }
        try fileManager.createDirectory(at: outputURL, withIntermediateDirectories: true)

        let catalogURL = outputURL.appendingPathComponent("\(targetName).xcassets", isDirectory: true)
        try fileManager.createDirectory(at: catalogURL, withIntermediateDirectories: true)
        let rootContents = """
        {
          "info" : {
            "author" : "easysymbols",
            "version" : 1
          }
        }
        """
        try Data(rootContents.utf8).write(
            to: catalogURL.appendingPathComponent("Contents.json"),
            options: .atomic,
        )

        var accessors: [(name: String, property: String)] = []
        var seenNames = Set<String>()
        var seenProperties = Set<String>()
        for (index, symbol) in manifest.symbols.enumerated() {
            guard !symbol.source.isEmpty,
                  !symbol.source.hasPrefix("/") else {
                throw GeneratorError.invalidSource(symbol.source)
            }
            let sourceURL = sourceRootURL
                .appendingPathComponent(symbol.source)
                .standardizedFileURL
            guard isInside(sourceURL, root: sourceRootURL) else {
                throw GeneratorError.invalidSource("path escapes SymbolSources: \(symbol.source)")
            }
            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: sourceURL.path, isDirectory: &isDirectory),
                  isDirectory.boolValue,
                  sourceURL.pathExtension == "symbolset" else {
                throw GeneratorError.invalidSource("expected a .symbolset directory: \(symbol.source)")
            }

            let sourceBaseName = sourceURL.deletingPathExtension().lastPathComponent
            let assetName = normalizeName(symbol.name ?? sourceBaseName)
            guard !assetName.isEmpty,
                  assetName == normalizeName(sourceBaseName) else {
                throw GeneratorError.invalidSource(
                    "symbol name must match its .symbolset directory: \(symbol.source)",
                )
            }
            guard seenNames.insert(assetName).inserted else {
                throw GeneratorError.duplicateName(assetName)
            }

            let destinationURL = catalogURL.appendingPathComponent("\(assetName).symbolset", isDirectory: true)
            try fileManager.copyItem(at: sourceURL, to: destinationURL)

            let property = swiftPropertyName(assetName, index: index)
            guard seenProperties.insert(property).inserted else {
                throw GeneratorError.invalidManifest(
                    "symbol names \(assetName) and another symbol produce the same Swift accessor \(property)",
                )
            }
            accessors.append((name: assetName, property: property))
        }

        let constants = accessors
            .map { "    static let \($0.property) = \(swiftString($0.name))" }
            .joined(separator: "\n")
        let generatedSource = """
        import Foundation
        #if canImport(SwiftUI)
        import SwiftUI
        #endif

        /// Generated by EasySymbols' SwiftPM build plugin.
        public extension \(targetName) {
            static let bundle: Bundle = .module
        \(constants)
        }

        #if canImport(SwiftUI)
        public extension \(targetName) {
            static func image(named name: String) -> Image {
                Image(name, bundle: bundle)
            }
        }
        #endif
        """
        try Data(generatedSource.utf8).write(
            to: outputURL.appendingPathComponent("GeneratedSymbols.swift"),
            options: .atomic,
        )
    }

    private static func isInside(_ candidate: URL, root: URL) -> Bool {
        candidate.path == root.path || candidate.path.hasPrefix(root.path + "/")
    }

    private static func normalizeName(_ raw: String) -> String {
        let withoutExtension = raw.replacingOccurrences(
            of: #"\.(svg|symbolset)$"#,
            with: "",
            options: .regularExpression,
        )
        let separated = withoutExtension.replacingOccurrences(
            of: #"[^A-Za-z0-9._-]+"#,
            with: "-",
            options: .regularExpression,
        )
        let collapsed = separated.replacingOccurrences(
            of: #"-{2,}"#,
            with: "-",
            options: .regularExpression,
        )
        return collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "-."))
    }

    private static func swiftPropertyName(_ raw: String, index: Int) -> String {
        var candidate = raw.replacingOccurrences(
            of: #"[^A-Za-z0-9_]+"#,
            with: "_",
            options: .regularExpression,
        )
        candidate = candidate.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        if candidate.isEmpty {
            candidate = "symbol\(index + 1)"
        }
        if candidate.first?.isNumber == true {
            candidate = "symbol_\(candidate)"
        }
        if swiftReservedWords.contains(candidate) {
            candidate += "Symbol"
        }
        return candidate
    }

    private static func swiftString(_ value: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [value], options: [])
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }

    private static let swiftReservedWords: Set<String> = [
        "associatedtype", "class", "deinit", "enum", "extension", "fileprivate",
        "func", "import", "init", "inout", "let", "protocol", "repeat", "static",
        "struct", "subscript", "typealias", "var", "break", "case", "continue",
        "default", "defer", "do", "else", "fallthrough", "for", "guard", "if",
        "in", "return", "switch", "where", "while", "as", "Any", "catch", "false",
        "is", "nil", "super", "self", "Self", "throw", "throws", "true", "try",
        "actor", "async", "await", "borrowing", "consuming", "distributed", "internal",
        "isolated", "macro", "mutating", "nonisolated", "nonmutating", "open", "operator",
        "package", "private", "public", "sending", "some", "unowned", "weak",
    ]
}
`;
}
