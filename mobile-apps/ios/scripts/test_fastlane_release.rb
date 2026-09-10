# Run the actual lane with fake Apple APIs; no network or credentials required.
module UI
  def self.user_error!(message)
    raise message
  end

  def self.message(_message); end
  def self.success(_message); end
end

module Spaceship
  module ConnectAPI
    class Build
      module ProcessingState
        VALID = "VALID"
        FAILED = "FAILED"
        INVALID = "INVALID"
      end

      class << self
        attr_accessor :state, :request

        def all(**options)
          self.request = options
          [Struct.new(:processing_state).new(state)]
        end
      end
    end
  end
end

class LaneHarness
  attr_reader :uploads

  def initialize
    @uploads = []
    fastfile = File.expand_path("../fastlane/Fastfile", __dir__)
    instance_eval(File.read(fastfile), fastfile)
  end

  def default_platform(_platform); end
  def desc(_description); end
  def platform(_platform)
    yield
  end

  def lane(_name, &block)
    @lane = block
  end

  def app_store_connect_api_key(**_options)
    { test_key: true }
  end

  def upload_to_app_store(**options)
    @uploads << options
  end

  def run(**options)
    @lane.call(options)
  end
end

def assert(condition, message)
  raise message unless condition
end

%w[APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_PRIVATE_KEY_BASE64].each do |key|
  ENV[key] = "offline-test"
end
build = Spaceship::ConnectAPI::Build
build.state = "VALID"
runner = LaneHarness.new
runner.run(version: "1.0.1", build_number: "241", verify_only: true)
assert(runner.uploads.empty?, "Verification must never update or submit the app")
assert(build.request[:version] == "1.0.1" && build.request[:build_number] == "241", "Must query the exact build")

runner.run(version: "1.0.1", build_number: "241")
assert(runner.uploads.length == 1, "Submission should invoke deliver exactly once")
upload = runner.uploads.first
assert(upload[:build_number] == "241" && upload[:app_version] == "1.0.1", "Must submit the selected version/build")
assert(upload[:submit_for_review] && upload[:automatic_release] && upload[:skip_binary_upload], "Submission policy changed")

begin
  runner.run(version: "1.0.1", build_number: "241", verify_only: "tru")
  raise "Invalid verification option was accepted"
rescue RuntimeError => error
  raise unless error.message == "verify_only must be true or false"
end

%w[FAILED INVALID].each do |state|
  build.state = state
  begin
    runner.run(version: "1.0.1", build_number: "241", verify_only: true)
    raise "Invalid build was accepted"
  rescue RuntimeError => error
    raise unless error.message.include?("marked it #{state}")
  end
end
assert(runner.uploads.length == 1, "Rejected requests must not submit")
puts "Fastlane checks passed: read-only verification, exact-build submission, and rejection paths."
