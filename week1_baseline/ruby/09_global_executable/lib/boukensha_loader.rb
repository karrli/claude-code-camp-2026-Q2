# BoukenshaLoader resolves which step folder to load from, then boots the REPL.
#
# Resolution order:
#   1. BOUKENSHA_PATH environment variable (selects which *step* lib to load)
#   2. ~/.boukensharc  path: key  (a YAML file, see below)
#   3. The lib/ directory bundled inside this gem (step 8 — the latest release)
#
# Config directory (settings.yaml, .env, system.md) resolves the same way:
#   1. BOUKENSHA_DIR environment variable
#   2. ~/.boukensharc  dir: key
#   3. ~/.boukensha  (default)
#
# ~/.boukensharc is a small YAML file:
#   path: ~/Sites/boukensha/08_the_repl_loop
#   dir: ~/projects/mybot/.boukensha
#
# For backwards compatibility, a ~/.boukensharc containing just a bare path
# (no YAML keys) is still accepted and treated as `path:`.
#
# Examples:
#   boukensha                                                              # uses bundled lib + ~/.boukensha
#   BOUKENSHA_PATH=~/Sites/boukensha/04_api_client boukensha              # loads step 4
#   BOUKENSHA_DIR=~/projects/mybot/.boukensha boukensha                   # custom config dir
#   echo "path: ~/Sites/boukensha/08_the_repl_loop" > ~/.boukensharc      # permanent step default
require "yaml"

module BoukenshaLoader
  # Absolute path to this gem's own bundled boukensha lib.
  BUNDLED_LIB = File.expand_path("../boukensha.rb", __FILE__)

  RC_FILE = File.expand_path("~/.boukensharc")

  def self.resolve
    rc = read_rc

    # BOUKENSHA_DIR: env var wins, then ~/.boukensharc, then Config's own default.
    ENV["BOUKENSHA_DIR"] ||= rc["dir"] if rc["dir"]

    # BOUKENSHA_PATH: env var wins, then ~/.boukensharc, then the bundled default.
    path   = ENV["BOUKENSHA_PATH"] || rc["path"]
    source = ENV["BOUKENSHA_PATH"] ? "BOUKENSHA_PATH" : "~/.boukensharc"

    return BUNDLED_LIB unless path

    dir  = File.expand_path(path)
    main = File.join(dir, "lib", "boukensha.rb")
    return main if File.exist?(main)

    abort <<~MSG
      boukensha: #{source} points to #{dir}
             but no lib/boukensha.rb was found there.
             Make sure it points to a step folder, e.g.:
             BOUKENSHA_PATH=~/Sites/boukensha/07_the_repl_loop boukensha
    MSG
  end

  # Parses ~/.boukensharc as YAML. Accepts either:
  #   path: ~/Sites/boukensha/08_the_repl_loop
  #   dir: ~/projects/mybot/.boukensha
  # or, for backwards compatibility, a single bare path (treated as `path:`):
  #   ~/Sites/boukensha/08_the_repl_loop
  def self.read_rc
    return {} unless File.exist?(RC_FILE)

    parsed = YAML.safe_load(File.read(RC_FILE))
    case parsed
    when String
      parsed.strip.empty? ? {} : { "path" => parsed.strip }
    when Hash
      parsed
    else
      {}
    end
  rescue Psych::SyntaxError => e
    abort "boukensha: could not parse ~/.boukensharc as YAML (#{e.message})"
  end

  def self.load_and_start_repl
    main = resolve
    step_dir = File.dirname(File.dirname(main))

    puts "[boukensha] loading from: #{step_dir}" if ENV["BOUKENSHA_DEBUG"]

    require main

    unless Boukensha.respond_to?(:repl)
      abort <<~MSG
        boukensha: the step at #{step_dir}
               does not support the interactive REPL (added in step 7).
               Run its examples directly, e.g.:
                 ruby #{step_dir}/examples/*.rb
               Or point BOUKENSHA_PATH at step 7 or later.
      MSG
    end

    Boukensha.repl
  end
end
