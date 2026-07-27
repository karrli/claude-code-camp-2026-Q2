#!/usr/bin/env ruby
# frozen_string_literal: true

# Tiny zero-dependency HTTP server (stdlib only) that:
#   - serves this directory's static frontend files
#   - exposes .boukensha/sessions as a small JSON/tail API
#
# The browser's File System Access API can't grant filesystem access
# without a user click, every time, forever — that's a hard security
# limit, not a bug. Routing reads through a local server instead lets
# the frontend `fetch()` the sessions directory on its own, so the app
# loads and updates automatically with no folder/file picker at all.

require "socket"
require "json"
require "time"

ROOT = File.expand_path(__dir__)
SESSIONS_DIR = File.expand_path("../../.boukensha/sessions", ROOT)
PORT = (ENV["PORT"] || 8934).to_i

MIME_TYPES = {
  ".html" => "text/html; charset=utf-8",
  ".js" => "text/javascript; charset=utf-8",
  ".css" => "text/css; charset=utf-8",
  ".json" => "application/json; charset=utf-8",
}.freeze

def send_response(socket, status, headers, body)
  headers = { "Content-Length" => body.bytesize.to_s, "Connection" => "close" }.merge(headers)
  socket.write "HTTP/1.1 #{status}\r\n"
  headers.each { |k, v| socket.write "#{k}: #{v}\r\n" }
  socket.write "\r\n"
  socket.write body
end

def json_response(socket, status, data)
  send_response(socket, status, { "Content-Type" => "application/json; charset=utf-8" }, JSON.generate(data))
end

def not_found(socket)
  send_response(socket, "404 Not Found", { "Content-Type" => "text/plain" }, "not found")
end

def serve_static(socket, path)
  path = "/index.html" if path == "/"
  file = File.expand_path(File.join(ROOT, path))
  return not_found(socket) unless file.start_with?(ROOT) && File.file?(file)

  content_type = MIME_TYPES.fetch(File.extname(file), "application/octet-stream")
  send_response(socket, "200 OK", { "Content-Type" => content_type }, File.binread(file))
end

def list_sessions(socket)
  files = Dir.glob(File.join(SESSIONS_DIR, "*.jsonl")).map do |path|
    stat = File.stat(path)
    { name: File.basename(path), size: stat.size, mtime: stat.mtime.iso8601 }
  end
  # Session filenames are ISO8601-timestamp-prefixed, so name order is time order.
  files.sort_by! { |f| f[:name] }
  files.reverse!
  json_response(socket, "200 OK", files)
end

def tail_session(socket, name, offset)
  file = File.join(SESSIONS_DIR, File.basename(name))
  return not_found(socket) unless File.file?(file)

  size = File.size(file)
  offset = 0 if offset.negative? || offset > size

  chunk = String.new(encoding: Encoding::UTF_8)
  if size > offset
    File.open(file, "rb") do |f|
      f.seek(offset)
      chunk = f.read(size - offset).to_s.force_encoding(Encoding::UTF_8)
    end
  end

  send_response(
    socket, "200 OK",
    { "Content-Type" => "text/plain; charset=utf-8", "X-File-Size" => size.to_s },
    chunk
  )
end

def handle(socket)
  request_line = socket.gets
  return unless request_line

  method, full_path, = request_line.split(" ")
  while (line = socket.gets) && line != "\r\n"
    # drain request headers; this server only handles GET with no body
  end
  return unless full_path

  path, query = full_path.split("?", 2)
  params = (query || "").split("&").each_with_object({}) do |pair, memo|
    k, v = pair.split("=", 2)
    memo[k] = v
  end

  if method != "GET"
    send_response(socket, "405 Method Not Allowed", { "Content-Type" => "text/plain" }, "method not allowed")
  elsif path == "/api/sessions"
    list_sessions(socket)
  elsif (match = path.match(%r{\A/api/sessions/([^/]+)/tail\z}))
    tail_session(socket, match[1], params.fetch("offset", "0").to_i)
  else
    serve_static(socket, path)
  end
rescue StandardError => e
  warn "[log-viewer] request error: #{e.class}: #{e.message}"
ensure
  socket.close
end

Dir.mkdir(SESSIONS_DIR) unless Dir.exist?(SESSIONS_DIR)

server = TCPServer.new(PORT)
puts "Boukensha Log Viewer: http://localhost:#{PORT}"
puts "Serving sessions from #{SESSIONS_DIR}"

loop do
  client = server.accept
  Thread.new(client) { |socket| handle(socket) }
end
